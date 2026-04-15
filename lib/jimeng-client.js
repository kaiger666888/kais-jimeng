/**
 * kais-jimeng — 统一即梦 API 客户端
 *
 * QPS 限流规则：
 * - QPS = 1：每秒最多 1 个请求
 * - 触发限流后需等待 60 秒才能恢复
 * - 策略：正常请求间隔 1s，429 时自动等待 Retry-After 后恢复
 */

// ─── 高效令牌桶限流器 ─────────────────────────────────

class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.minIntervalMs — 请求最小间隔（默认 1050ms，略大于 QPS=1）
   * @param {number} options.maxRetryAfter — 429 时最大等待秒数（默认 120）
   */
  constructor({ minIntervalMs = 1050, maxRetryAfter = 120 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxRetryAfter = maxRetryAfter;
    this._lastRequestTime = 0;
    this._queue = [];          // 等待队列
    this._processing = false;  // 是否正在处理队列
  }

  /** 等待直到可以发送下一个请求 */
  async wait() {
    return new Promise(resolve => {
      this._queue.push(resolve);
      this._drain();
    });
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this._lastRequestTime;
      const delay = Math.max(0, this.minIntervalMs - elapsed);

      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }

      this._lastRequestTime = Date.now();
      const resolve = this._queue.shift();
      resolve();
    }

    this._processing = false;
  }

  /** 请求成功后刷新时间戳（_drain 已自动处理） */
  succeed() {
    this._lastRequestTime = Date.now();
  }

  /** 429 限流时，解析 Retry-After 并等待 */
  async handleRateLimit(retryAfterHeader) {
    // 清空队列中的等待，因为限流期间所有请求都会失败
    const waitSec = retryAfterHeader
      ? Math.min(parseInt(retryAfterHeader, 10) || 60, this.maxRetryAfter)
      : 60;

    console.warn(`[jimeng] ⚠️ 触发限流，等待 ${waitSec}s 后恢复...`);
    this._lastRequestTime = 0; // 重置，等待后从新时间戳开始
    await new Promise(r => setTimeout(r, waitSec * 1000));
    this._lastRequestTime = Date.now();
  }

  /** 当前统计信息 */
  get stats() {
    return {
      minIntervalMs: this.minIntervalMs,
      queueLength: this._queue.length,
      idle: this._queue.length === 0,
    };
  }
}

// ─── 共享限流器实例 ─────────────────────────────────

const sharedLimiter = new RateLimiter({ minIntervalMs: 1050 });

export { RateLimiter, sharedLimiter };

// ─── 限流错误检测 ──────────────────────────────────────

function isRateLimitError(status, bodyText) {
  if (status === 429) return true;
  const t = (bodyText || '').toLowerCase();
  return t.includes('频繁') || t.includes('频率') || t.includes('too many') ||
         t.includes('rate limit') || t.includes('qps');
}

export class JimengClient {
  constructor(baseUrl = "http://localhost:8000", options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sessionId = process.env.JIMENG_SESSION_ID || "";
    this.limiter = options.limiter || sharedLimiter;
    this._envFile = options.envFile || null;
  }

  /**
   * 从 .env 文件加载 sessionid（替代环境变量）
   */
  loadSessionFromFile(envFile) {
    try {
      const { readFileSync, existsSync } = require("node:fs");
      if (!existsSync(envFile)) return false;
      const content = readFileSync(envFile, "utf-8");
      const match = content.match(/JIMENG_SESSION_ID=(.+)/);
      if (match?.[1]?.trim()) {
        this.sessionId = match[1].trim();
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * 带限流的 fetch 封装
   * - 自动等待 QPS 间隔（1.05s）
   * - 429 自动等待 Retry-After 后重试（最多 3 次）
   */
  async _fetch(url, options = {}, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.limiter.wait();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120_000);
      let res;
      try {
        res = await fetch(url, { ...options, signal: controller.signal });
      } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error(`即梦 API 超时: ${url}`);
        throw new Error(`即梦 API 连接失败: ${e.message}`);
      } finally {
        clearTimeout(timer);
      }

      this.limiter.succeed();

      // 429 限流 → 自动等待重试
      if (res.status === 429 || isRateLimitError(res.status, '')) {
        await this.limiter.handleRateLimit(res.headers.get('Retry-After'));
        if (attempt < maxRetries) continue;
        const text = await res.text().catch(() => '');
        throw new Error(`即梦 API 限流，重试 ${maxRetries} 次后仍失败: ${text}`);
      }

      return res;
    }
  }

  /** 健康检查（不限流） */
  async ping(timeoutMs = 5000) {
    try {
      const res = await fetch(`${this.baseUrl}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** 文生图/图生图 */
  async generateImage(prompt, options = {}) {
    const { model = "jimeng-5.0", ratio = "16:9", resolution = "2k", seed, images, timeoutMs = 120_000 } = options;

    const body = { model, prompt, ratio, resolution };
    if (seed != null) body.seed = seed;
    if (images?.length) body.images = images;

    const res = await this._fetch(`${this.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`即梦 API 错误 ${res.status}: ${text}`);

    const json = await JSON.parse(text);
    return json.data || [];
  }

  /** 视频生成（同步，普通模型如 jimeng-video-3.5-pro） */
  async generateVideo(prompt, options = {}) {
    const { model = "jimeng-video-3.5-pro", ratio = "1:1", duration = 5, timeoutMs = 600_000 } = options;

    const body = { model, prompt, ratio, duration };

    const res = await this._fetch(`${this.baseUrl}/v1/videos/generations`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`即梦视频 API 错误 ${res.status}: ${text}`);

    const json = await JSON.parse(text);
    return json.data?.[0]?.url || null;
  }

  /** 提交 Seedance 异步视频任务 */
  async submitSeedanceTask(prompt, filePaths, options = {}) {
    const { model = "jimeng-video-seedance-2.0-fast", ratio = "16:9", duration = 4, timeoutMs = 60_000 } = options;

    let finalPrompt = prompt;
    if (!finalPrompt.startsWith("@")) {
      finalPrompt = `@1 ${finalPrompt}`;
    }

    const body = { model, prompt: finalPrompt, ratio, duration, file_paths: filePaths };

    const res = await this._fetch(`${this.baseUrl}/v1/videos/generations/async`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`即梦异步 API 错误 ${res.status}: ${text}`);

    const json = await JSON.parse(text);
    return json.task_id || null;
  }

  /** 轮询异步任务直到完成（渐进式间隔，节省 QPS 配额） */
  async pollTask(taskId, options = {}) {
    const { timeoutMs = 900_000 } = options;
    const start = Date.now();
    let intervalMs = 15_000; // 初始 15s，逐步增加到 60s

    while (Date.now() - start < timeoutMs) {
      // 等待 QPS 间隔
      await this.limiter.wait();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let res;
      try {
        res = await fetch(`${this.baseUrl}/v1/videos/generations/async/${taskId}`, {
          headers: { "Authorization": `Bearer ${this.sessionId}` },
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`即梦轮询 API 连接失败: ${e.message}`);
      } finally {
        clearTimeout(timer);
      }

      this.limiter.succeed();

      if (!res.ok) {
        if (res.status === 429) {
          await this.limiter.handleRateLimit(res.headers.get('Retry-After'));
          continue;
        }
        const text = await res.text().catch(() => "");
        throw new Error(`即梦轮询 API 错误 ${res.status}: ${text}`);
      }

      const json = await res.json();

      if (json.data?.[0]?.url) {
        return json.data[0].url;
      }

      if (json.error || json.status === "failed") {
        throw new Error(`异步任务失败: ${json.error || json.message || "未知错误"}`);
      }

      // 渐进式间隔：15s → 30s → 45s → 60s（节省 QPS 配额）
      await new Promise(r => setTimeout(r, intervalMs));
      intervalMs = Math.min(60_000, intervalMs + 15_000);
    }

    throw new Error(`异步任务超时 (${timeoutMs / 1000}s)，task_id: ${taskId}`);
  }

  /**
   * 检测当前 session 是否有效，无效时提示刷新
   * @returns {Promise<boolean>}
   */
  async checkSession() {
    if (!this.sessionId) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.sessionId}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "jimeng-5.0", prompt: "test", ratio: "1:1", resolution: "1k" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status === 200) return true;
      if (res.status === 401) return false;
      const text = await res.text().catch(() => "");
      return !text.includes("请先登录") && !text.includes("未登录");
    } catch {
      return null; // API 不可达
    }
  }

  /** 下载文件到本地（不限流，不走 API） */
  async download(url, outputPath) {
    const { createWriteStream } = await import("node:fs");
    const { pipeline: streamPipeline } = await import("node:stream/promises");
    const { Readable } = await import("node:stream");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败: ${res.status} ${url}`);
    if (!res.body) throw new Error("响应无 body stream");

    const nodeStream = Readable.fromWeb(res.body);
    await streamPipeline(nodeStream, createWriteStream(outputPath));
    return outputPath;
  }

  /**
   * 批量生图（自动间隔，QPS 安全）
   * 每张图间隔 ~1s，触发限流自动等待恢复。
   * @param {Array<{prompt: string, options?: object}>} tasks
   * @param {Function} [onProgress] — (index, result) => void
   * @returns {Promise<Array<{index: number, data: Array, error?: string}>>}
   */
  async batchGenerateImages(tasks, onProgress) {
    const results = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const data = await this.generateImage(task.prompt, task.options);
        results.push({ index: i, data });
      } catch (e) {
        results.push({ index: i, data: [], error: e.message });
      }
      onProgress?.(i, results[results.length - 1]);
    }
    return results;
  }

  /**
   * 批量提交异步视频任务（自动间隔，QPS 安全）
   * 提交完所有任务后返回 taskId 列表，不等待完成。
   * @param {Array<{prompt: string, filePaths: string[], options?: object}>} tasks
   * @returns {Promise<Array<{index: number, taskId: string|null, error?: string}>>}
   */
  async batchSubmitTasks(tasks) {
    const results = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const taskId = await this.submitSeedanceTask(task.prompt, task.filePaths, task.options);
        results.push({ index: i, taskId });
      } catch (e) {
        results.push({ index: i, taskId: null, error: e.message });
      }
    }
    return results;
  }
}

export default JimengClient;
