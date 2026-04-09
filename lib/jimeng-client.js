/**
 * kais-jimeng — 统一即梦 API 客户端
 *
 * 所有 skill 和 pipeline 通过此客户端与即梦 API 交互，
 * 避免各处重复实现 fetch 逻辑。
 */

export class JimengClient {
  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sessionId = process.env.JIMENG_SESSION_ID || "";
  }

  /** 健康检查 */
  async ping(timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/ping`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 文生图/图生图 */
  async generateImage(prompt, options = {}) {
    const { model = "jimeng-5.0", ratio = "16:9", resolution = "2k", seed, images, timeoutMs = 120_000 } = options;

    const body = { model, prompt, ratio, resolution };
    if (seed != null) body.seed = seed;
    if (images?.length) body.images = images;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    // 返回完整 data 数组 [{ url, seed }, ...]
    return json.data || [];
  }

  /** 视频生成（同步，普通模型如 jimeng-video-3.5-pro） */
  async generateVideo(prompt, options = {}) {
    const { model = "jimeng-video-3.5-pro", ratio = "1:1", duration = 5, timeoutMs = 600_000 } = options;

    const body = { model, prompt, ratio, duration };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/videos/generations`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦视频 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦视频 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.data?.[0]?.url || null;
  }

  /** 提交 Seedance 异步视频任务 */
  async submitSeedanceTask(prompt, filePaths, options = {}) {
    const { model = "jimeng-video-seedance-2.0-fast", ratio = "16:9", duration = 4, timeoutMs = 60_000 } = options;

    // prompt 中自动加 @1 引用（如果没有的话）
    let finalPrompt = prompt;
    if (!finalPrompt.startsWith("@")) {
      finalPrompt = `@1 ${finalPrompt}`;
    }

    const body = { model, prompt: finalPrompt, ratio, duration, file_paths: filePaths };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/videos/generations/async`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦异步 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦异步 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.task_id || null;
  }

  /** 轮询异步任务直到完成 */
  async pollTask(taskId, options = {}) {
    const { timeoutMs = 900_000, intervalMs = 10_000 } = options;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
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

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`即梦轮询 API 错误 ${res.status}: ${text}`);
      }

      const json = await res.json();

      // 成功：返回视频 URL
      if (json.data?.[0]?.url) {
        return json.data[0].url;
      }

      // 仍在处理中
      if (json.status === "processing" || json.status === "pending" || !json.data?.[0]?.url) {
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      }

      // 失败
      if (json.error || json.status === "failed") {
        throw new Error(`异步任务失败: ${json.error || json.message || "未知错误"}`);
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }

    throw new Error(`异步任务超时 (${timeoutMs / 1000}s)，task_id: ${taskId}`);
  }

  /** 下载文件到本地 */
  async download(url, outputPath) {
    const { createWriteStream } = await import("node:fs");
    const { pipeline: streamPipeline } = await import("node:stream/promises");
    const { Readable } = await import("node:stream");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败: ${res.status} ${url}`);
    if (!res.body) throw new Error("响应无 body stream");

    // Node.js fetch body → Node.js readable
    const nodeStream = Readable.fromWeb(res.body);
    await streamPipeline(nodeStream, createWriteStream(outputPath));
    return outputPath;
  }
}

export default JimengClient;
