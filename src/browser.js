const {
  chromium
} = require("playwright");

const {
  spawn
} = require("child_process");

const fs = require("fs");
const path = require("path");

const {
  addLog
} = require("./logger");

let browserContext = null;
let displayProcess = null;
let windowManagerProcess = null;

const dataDir =
  process.env.DATA_DIR ||
  "/tmp/remain-data";

const browserDataDir =
  path.join(
    dataDir,
    "browser"
  );

/*
 * ============================
 * Xvfb
 * ============================
 */

function startDisplay() {

  if (displayProcess) {
    return;
  }

  addLog(
    "正在启动 Xvfb..."
  );

  displayProcess = spawn(
    "Xvfb",
    [
      ":99",
      "-screen",
      "0",
      "1280x720x24",
      "-ac",
      "-nolisten",
      "tcp"
    ],
    {
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );

  displayProcess.stdout.on(
    "data",
    data => {
      console.log(
        `[Xvfb] ${data}`
      );
    }
  );

  displayProcess.stderr.on(
    "data",
    data => {
      console.error(
        `[Xvfb] ${data}`
      );
    }
  );

  displayProcess.on(
    "exit",
    code => {

      console.log(
        `[Xvfb] exited with code ${code}`
      );

      displayProcess = null;
    }
  );

  process.env.DISPLAY = ":99";
}

/*
 * ============================
 * Fluxbox
 * ============================
 */

function startWindowManager() {

  if (windowManagerProcess) {
    return;
  }

  addLog(
    "正在启动 Fluxbox..."
  );

  windowManagerProcess = spawn(
    "fluxbox",
    [],
    {
      env: {
        ...process.env,
        DISPLAY: ":99"
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );

  windowManagerProcess.stdout.on(
    "data",
    data => {
      console.log(
        `[Fluxbox] ${data}`
      );
    }
  );

  windowManagerProcess.stderr.on(
    "data",
    data => {
      console.error(
        `[Fluxbox] ${data}`
      );
    }
  );
}

/*
 * ============================
 * Browser
 * ============================
 */

async function getBrowserContext() {

  if (browserContext) {
    return browserContext;
  }

  startDisplay();

  startWindowManager();

  fs.mkdirSync(
    browserDataDir,
    {
      recursive: true
    }
  );

  addLog(
    "正在启动有头 Chromium..."
  );

  browserContext =
    await chromium.launchPersistentContext(
      browserDataDir,
      {
        headless: false,

        viewport: {
          width: 1280,
          height: 720
        },

        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--window-size=1280,720"
        ]
      }
    );

  addLog(
    "Chromium 启动成功"
  );

  return browserContext;
}

/*
 * ============================
 * Visit
 * ============================
 */

async function visit(
  url,
  staySeconds = 10
) {

  const context =
    await getBrowserContext();

  let page;

  try {

    const pages =
      context.pages();

    if (pages.length > 0) {

      page = pages[0];

    } else {

      page =
        await context.newPage();

    }

    /*
     * 不在日志中输出 URL
     */
    addLog(
      "正在访问目标网页"
    );

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 60000
      }
    );

    /*
     * 不在日志中输出 URL
     */
    addLog(
      "页面加载完成"
    );

    await page.waitForTimeout(
      staySeconds * 1000
    );

    addLog(
      `页面停留 ${staySeconds} 秒结束`
    );

    addLog(
      "访问完成"
    );

    return {
      success: true
    };

  } catch (error) {

    /*
     * 错误信息中可能包含 URL，
     * 因此这里也不直接输出 error.message。
     */
    addLog(
      `访问失败：${error.name || "未知错误"}`,
      "error"
    );

    console.error(
      "[Browser] Visit error:",
      error
    );

    return {
      success: false,
      error: error.message
    };
  }
}

/*
 * ============================
 * Close Browser
 * ============================
 */

async function closeBrowser() {

  if (browserContext) {

    try {

      await browserContext.close();

    } catch (error) {

      console.error(
        "[Browser] Close error:",
        error.message
      );

    }

    browserContext = null;
  }

  if (windowManagerProcess) {

    windowManagerProcess.kill();

    windowManagerProcess = null;
  }

  if (displayProcess) {

    displayProcess.kill();

    displayProcess = null;
  }

  addLog(
    "浏览器已关闭"
  );
}

module.exports = {
  visit,
  closeBrowser
};
