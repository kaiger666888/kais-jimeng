/**
 * kais-jimeng — Session Manager
 *
 * 自动管理即梦官网 sessionid cookie：
 * 1. 检测当前 session 是否有效
 * 2. 无效时自动打开浏览器，引导用户扫码登录
 * 3. 登录成功后提取 sessionid 并写入环境变量文件
 *
 * 用法:
 *   node session-manager.js check          # 检查当前 session
 *   node session-manager.js refresh         # 强制刷新 session
 *   node session-manager.js get             # 获取当前 sessionid
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");
const ENV_FILE = resolve(SKILL_DIR, ".env");
const COOKIE_FILE = resolve(SKILL_DIR, ".jimeng-cookies.json");
const PROFILE_DIR = resolve(SKILL_DIR, ".browser-data");

const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/image/generate";
const COOKIE_NAME = "sessionid";
const SESSION_CHECK_URL = "https://jimeng.jianying.com/ai-tool/home";
// 即梦 cookie 可能在多个域下
const COOKIE_DOMAINS = [".jianying.com", ".douyin.com", ".bytedance.com"];

// ─── Cookie 持久化 ──────────────────────────────────

/** 读取 .env 文件中的 JIMENG_SESSION_ID */
function loadSessionFromEnv() {
  if (!existsSync(ENV_FILE)) return "";
  const content = readFileSync(ENV_FILE, "utf-8");
  const match = content.match(/JIMENG_SESSION_ID=(.+)/);
  return match?.[1]?.trim() || "";
}

/** 写入 sessionid 到 .env 文件 */
function saveSessionToEnv(sessionId) {
  let content = "";
  if (existsSync(ENV_FILE)) {
    content = readFileSync(ENV_FILE, "utf-8");
  }
  if (content.includes("JIMENG_SESSION_ID=")) {
    content = content.replace(/JIMENG_SESSION_ID=.*/, `JIMENG_SESSION_ID=${sessionId}`);
  } else {
    content += `\nJIMENG_SESSION_ID=${sessionId}\n`;
  }
  writeFileSync(ENV_FILE, content, "utf-8");
  console.log(`[session] ✅ sessionid 已保存到 ${ENV_FILE}`);
}

/** 保存 cookies 到文件（用于 profile 复用） */
function saveCookies(cookies) {
  writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), "utf-8");
}

/** 读取保存的 cookies */
function loadCookies() {
  if (!existsSync(COOKIE_FILE)) return null;
  return JSON.parse(readFileSync(COOKIE_FILE, "utf-8"));
}

// ─── Session 有效性检测 ─────────────────────────────

/**
 * 通过 API 检测 sessionid 是否有效
 * 使用 jimeng-free-api 的 ping 或简单请求
 */
async function checkSessionViaApi(sessionId) {
  if (!sessionId) return false;
  try {
    const res = await fetch("http://localhost:8000/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jimeng-5.0",
        prompt: "test",
        ratio: "1:1",
        resolution: "1k",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // 401 = session 过期，429 = session 有效但限流
    if (res.status === 429) return true;
    if (res.status === 401) return false;
    if (res.status === 200) return true;
    const text = await res.text().catch(() => "");
    // status:45 = 排队中，说明 session 有效
    if (text.includes("status") || text.includes("task_id")) return true;
    // 其他错误可能是 session 问题
    return false;
  } catch {
    // API 不在线，无法判断
    console.log("[session] ⚠️ jimeng-free-api 不可达，跳过 API 检测");
    return null;
  }
}

/**
 * 通过浏览器检测 session cookie 是否有效
 * 访问即梦首页，检查是否跳转到登录页
 */
async function checkSessionViaBrowser(cookies) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  if (cookies?.length) {
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  let isValid = false;

  try {
    await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000); // 等待 JS 执行

    // 检查是否跳转到了登录页
    const url = page.url();
    const hasLoginUrl = url.includes("login") || url.includes("passport") || url.includes("sso");
    const hasCreateBtn = await page.$("text=立即创作").catch(() => null) ||
                         await page.$("text=AI 创作").catch(() => null);

    isValid = !hasLoginUrl && hasCreateBtn;
  } catch (e) {
    console.log(`[session] ⚠️ 浏览器检测异常: ${e.message}`);
  } finally {
    await browser.close();
  }

  return isValid;
}

// ─── 浏览器登录流程 ─────────────────────────────────

/**
 * 打开浏览器，引导用户扫码登录即梦
 * 登录成功后提取 sessionid cookie
 */
async function loginViaBrowser(options = {}) {
  const { headless = false, timeout = 300_000 } = options;

  // 确保 profile 目录存在
  mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = browser.pages()[0] || await browser.newPage();

  try {
    // 先访问即梦首页
    console.log("[session] 🌐 正在打开即梦官网...");
    await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    // 检查是否已有有效 session cookie
    const cookies = await browser.cookies(...COOKIE_DOMAINS.map(d => `https://jimeng${d}`));
    const sessionCookie = cookies.find(c => c.name === COOKIE_NAME && c.value.length > 10);
    if (sessionCookie) {
      console.log("[session] ✅ 检测到已有 session cookie，验证中...");
      const url2 = page.url();
      if (!url2.includes("login") && !url2.includes("passport")) {
        console.log("[session] ✅ 已登录且 session 有效");
        return { sessionId: sessionCookie.value, cookies };
      }
      console.log("[session] ⚠️ session cookie 存在但已失效");
    }

    // 需要登录 — 验证成功的流程（2026-04-14）
    console.log("[session] 📱 触发登录流程...");

    // Step 1: 点击「图片生成」卡片
    await page.goto("https://jimeng.jianying.com/ai-tool/home", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      document.querySelectorAll(".button-YBvLch").forEach(c => {
        if (c.textContent.includes("图片生成")) c.click();
      });
    });
    await page.waitForTimeout(5000);

    // Step 2: 协议弹窗 — 点击「同意」（CSS modules hash 不固定，用 text filter）
    try {
      await page.locator(".lv-modal-content button").filter({ hasText: "同意" }).last().click({ timeout: 3000 });
      console.log("[session] ✅ 已同意服务协议");
    } catch {
      console.log("[session] ℹ️ 无协议弹窗，跳过");
    }
    await page.waitForTimeout(2000);

    // Step 3: OAuth 新 tab 会自动弹出二维码（同意后自动跳转，无需手动点登录按钮）
    console.log("[session] ✅ 等待二维码弹出，请扫码登录...");

    // 等待登录完成（检测 sessionid cookie 出现）
    console.log("[session] ⏳ 等待扫码登录完成（超时 5 分钟）...");
    console.log("[session] 💡 如果没有弹出登录框，请手动点击页面上的登录按钮");

    const startTime = Date.now();
    try {
      while (Date.now() - startTime < timeout) {
        await page.waitForTimeout(3000);

        // 检查页面是否还活着
        if (page.isClosed()) {
          throw new Error("浏览器窗口被关闭");
        }

        const cookies = await browser.cookies(...COOKIE_DOMAINS.map(d => `https://jimeng${d}`));
        const sessionCookie = cookies.find(c => c.name === COOKIE_NAME && c.value.length > 10);

        if (sessionCookie) {
          // 验证：访问页面确认登录成功
          if (!page.isClosed()) {
            await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForTimeout(2000);

            const currentUrl = page.url();
            const stillLoggedIn = !currentUrl.includes("login") && !currentUrl.includes("passport");

            if (stillLoggedIn) {
              console.log("[session] ✅ 登录成功！");
              return { sessionId: sessionCookie.value, cookies };
            }
          }
        }
      }
    } catch (e) {
      if (e.message === "浏览器窗口被关闭") {
        console.log("[session] ❌ 浏览器窗口被关闭，登录中断");
        return null;
      }
      throw e;
    }

    throw new Error("登录超时（5 分钟未检测到有效 session）");
  } finally {
    try { await browser.close(); } catch {}
  }
}

// ─── 主流程 ─────────────────────────────────────────

/**
 * 完整的 session 管理流程：
 * 1. 读取当前 sessionid
 * 2. 通过 API 检测有效性
 * 3. 无效时启动浏览器登录
 * 4. 保存新 session
 */
async function ensureSession(options = {}) {
  const { forceRefresh = false, interactive = true } = options;

  // 1. 读取当前 session
  let currentSession = loadSessionFromEnv();
  console.log(`[session] 📋 当前 sessionid: ${currentSession ? currentSession.slice(0, 10) + "..." : "(空)"}`);

  if (!forceRefresh && currentSession) {
    // 2. API 检测
    console.log("[session] 🔍 检测 session 有效性...");
    const apiResult = await checkSessionViaApi(currentSession);

    if (apiResult === true) {
      console.log("[session] ✅ 当前 session 有效（API 检测通过）");
      return currentSession;
    }

    if (apiResult === null) {
      // API 不可达，用浏览器检测
      const savedCookies = loadCookies();
      if (savedCookies) {
        console.log("[session] 🔍 通过浏览器检测 session...");
        const browserResult = await checkSessionViaBrowser(savedCookies);
        if (browserResult) {
          console.log("[session] ✅ 当前 session 有效（浏览器检测通过）");
          return currentSession;
        }
      }
    }

    console.log("[session] ❌ 当前 session 已失效");
  }

  // 3. 需要重新登录
  if (!interactive) {
    console.log("[session] ❌ 非交互模式，无法自动登录");
    return null;
  }

  console.log("[session] 🚀 启动浏览器登录流程...");
  const result = await loginViaBrowser({ headless: false });

  if (result) {
    // 4. 保存
    saveSessionToEnv(result.sessionId);
    saveCookies(result.cookies);
    console.log(`[session] ✅ 新 session 已保存: ${result.sessionId.slice(0, 10)}...`);
    return result.sessionId;
  }

  return null;
}

// ─── CLI 入口 ────────────────────────────────────────

const command = process.argv[2];

if (command === "check") {
  const session = loadSessionFromEnv();
  if (!session) {
    console.log("[session] ❌ 未找到 sessionid，请先运行: node session-manager.js refresh");
    process.exit(1);
  }
  console.log(`[session] 📋 当前 sessionid: ${session.slice(0, 10)}...`);
  const valid = await checkSessionViaApi(session);
  if (valid === true) console.log("[session] ✅ Session 有效");
  else if (valid === false) console.log("[session] ❌ Session 已失效，请运行: node session-manager.js refresh");
  else console.log("[session] ⚠️ API 不可达，无法判断");
} else if (command === "refresh") {
  const result = await ensureSession({ forceRefresh: true, interactive: true });
  if (result) {
    console.log(`\n[session] 🎉 刷新成功！新 sessionid: ${result.slice(0, 10)}...`);
    console.log("[session] 💡 如需更新 Docker 容器，请运行:");
    console.log("[session]    docker restart jimeng-free-api");
  } else {
    console.log("\n[session] ❌ 刷新失败");
    process.exit(1);
  }
} else if (command === "get") {
  const session = loadSessionFromEnv();
  console.log(session || "(空)");
} else if (command === "ensure") {
  // 供其他脚本调用，非交互式
  const result = await ensureSession({ interactive: false });
  if (result) {
    console.log(result);
  } else {
    console.log("NEED_LOGIN");
    process.exit(1);
  }
} else {
  console.log(`
kais-jimeng Session Manager

用法:
  node session-manager.js check    检查当前 session 有效性
  node session-manager.js refresh   强制刷新 session（打开浏览器扫码）
  node session-manager.js get       获取当前 sessionid
  node session-manager.js ensure    确保有效 session（非交互，失败退出 1）
`);
}

export { ensureSession, checkSessionViaApi, loginViaBrowser, loadSessionFromEnv, saveSessionToEnv };
export default { ensureSession, checkSessionViaApi, loginViaBrowser, loadSessionFromEnv, saveSessionToEnv };
