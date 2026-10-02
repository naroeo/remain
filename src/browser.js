const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { addLog } = require("./logger");

let browser = null;
let context = null;

let xvfb = null;
let fluxbox = null;
let display = null;

function commandExists(command) {
  try {
    require("child_process").execFileSync(
      "which",
      [command],
      {
        stdio: "ignore"
      }
    );

    return true;
  } catch {
    return false;
  }
}

async function ensureDisplay() {
  if (process.env.DISPLAY) {
    display = process.env.DISPLAY;
    return;
  }

  if (!commandExists("Xvfb")) {
    throw new Error("系统未安装 Xvfb");
  }

  if (!commandExists("fluxbox")) {
    throw new Error("系统未安装 fluxbox");
  }

  const displayNumber = 99;
  display = `:${displayNumber}`;

  xvfb = spawn(
    "Xvfb",
    [
      display,
      "-screen",
      "0",
      "1920x1080x24",
      "-ac"
    ],
    {
      detached: false,
      stdio: "ignore"
    }
  );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve();
    }, 1000);

    xvfb.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  process.env.DISPLAY = display;

  fluxbox = spawn(
    "fluxbox",
    [],
    {
      detached: false,
      stdio: "ignore"
    }
  );
}

async function ensureBrowser() {
  if (browser && context) {
    return;
  }

  await ensureDisplay();

  const userDataDir =
    process.env.PLAYWRIGHT_USER_DATA_DIR ||
    "/tmp/remain-playwright";

  fs.mkdirSync(userDataDir, {
    recursive: true
  });

  console.log(
    `[Browser] 启动 Chromium，用户目录：${userDataDir}`
  );

  context = await chromium.launchPersistentContext(
    userDataDir,
    {
      headless: false,

      viewport: {
        width: 1920,
        height: 1080
      },

      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-blink-features=AutomationControlled"
      ]
    }
  );

  browser = context;

  console.log("[Browser] Chromium 启动成功");
}

function getVisitErrorMessage(error, url) {
  let message = "";

  if (error && error.message) {
    message = String(error.message);
  } else if (error) {
    message = String(error);
  }

  if (!message) {
    message = "未知错误";
  }

  /*
   * Playwright 的错误信息有时会把完整 URL
   * 带在错误文本里。
   *
   * 日志里不需要再次显示完整 URL，
   * 因此只保留具体错误原因。
   */
  if (url) {
    message = message.split(String(url)).join("[目标 URL]");
  }

  return message;
}

async function visit(url, staySeconds = 10) {
  await ensureBrowser();

  let page = null;

  try {
    page = await context.newPage();

    console.log(
      `[Browser] 开始访问：${url}`
    );

    await page.goto(
      url,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    console.log(
      `[Browser] 页面加载完成：${url}`
    );

    if (staySeconds > 0) {
      await page.waitForTimeout(
        staySeconds * 1000
      );
    }

    console.log(
      `[Browser] 停留完成：${url}`
    );

    return {
      success: true
    };
  } catch (error) {
    const reason = getVisitErrorMessage(
      error,
      url
    );

    /*
     * 这里使用 error.message，而不是 error.name。
     *
     * 例如：
     * Error
     *
     * 会变成：
     * page.goto: net::ERR_NAME_NOT_RESOLVED at [目标 URL]
     *
     * 这样日志里才能看到真正的失败原因。
     */
    addLog(
      `访问失败：${reason}`,
      "error"
    );

    console.error(
      "[Browser] Visit error:",
      error
    );

    return {
      success: false,
      error: reason
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (error) {
        console.error(
          "[Browser] 页面关闭失败:",
          error
        );
      }
    }
  }
}

async function closeBrowser() {
  console.log("[Browser] 正在关闭浏览器...");

  if (context) {
    try {
      await context.close();
    } catch (error) {
      console.error(
        "[Browser] 关闭 Chromium 失败:",
        error
      );
    }

    context = null;
    browser = null;
  }

  if (fluxbox) {
    try {
      fluxbox.kill();
    } catch {}
    fluxbox = null;
  }

  if (xvfb) {
    try {
      xvfb.kill();
    } catch {}
    xvfb = null;
  }

  display = null;

  console.log("[Browser] 浏览器已关闭");
}

module.exports = {
  visit,
  closeBrowser
};
