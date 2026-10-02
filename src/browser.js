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

const crashpadDir =
  path.join(
    dataDir,
    "crashpad"
  );


/*
 * ============================
 * Start Xvfb
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
 * Start Fluxbox
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

  windowManagerProcess.on(
    "exit",
    code => {

      console.log(
        `[Fluxbox] exited with code ${code}`
      );

      windowManagerProcess = null;

    }
  );
}


/*
 * ============================
 * Browser Context
 * ============================
 */

async function getBrowserContext() {

  if (browserContext) {
    return browserContext;
  }

  startDisplay();

  /*
   * 给 Xvfb 一点启动时间。
   *
   * 容器启动时 Xvfb 是异步进程，
   * Chromium 太快启动可能会连接不到 DISPLAY。
   */

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        500
      )
  );

  startWindowManager();

  fs.mkdirSync(
    browserDataDir,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    crashpadDir,
    {
      recursive: true
    }
  );

  addLog(
    "正在启动有头 Chromium..."
  );

  try {

    browserContext =
      await chromium.launchPersistentContext(
        browserDataDir,
        {
          headless: false,

          viewport: {
            width: 1280,
            height: 720
          },

          env: {
            ...process.env,
            DISPLAY: ":99",
            HOME: "/tmp"
          },

          args: [
            "--no-sandbox",

            "--disable-dev-shm-usage",

            "--disable-gpu",

            "--disable-software-rasterizer",

            "--disable-background-networking",

            "--disable-background-timer-throttling",

            "--disable-renderer-backgrounding",

            "--disable-breakpad",

            "--disable-crash-reporter",

            "--noerrdialogs",

            "--disable-features=Crashpad",

            "--disable-features=Translate",

            "--disable-sync",

            "--disable-default-apps",

            "--no-first-run",

            "--no-default-browser-check",

            "--disable-component-update",

            "--disable-popup-blocking",

            "--disable-prompt-on-repost",

            "--disable-hang-monitor",

            "--window-size=1280,720"
          ]
        }
      );

    addLog(
      "Chromium 启动成功"
    );

    return browserContext;

  } catch (error) {

    browserContext = null;

    addLog(
      `Chromium 启动失败：${error.message}`,
      "error"
    );

    /*
     * 如果 Chromium 启动失败，
     * 清理一下可能残留的 browser context。
     */

    try {

      if (browserContext) {
        await browserContext.close();
      }

    } catch (_) {
      // ignore
    }

    browserContext = null;

    throw error;
  }
}


/*
 * ============================
 * Visit URL
 * ============================
 */

async function visit(
  url,
  staySeconds = 10
) {

  let context;

  try {

    context =
      await getBrowserContext();

    let page;

    const pages =
      context.pages();

    if (pages.length > 0) {

      page = pages[0];

    } else {

      page =
        await context.newPage();

    }

    addLog(
      `正在访问 ${url}`
    );

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

        timeout: 60000
      }
    );

    addLog(
      `页面加载完成：${url}`
    );

    await page.waitForTimeout(
      staySeconds * 1000
    );

    addLog(
      `页面停留 ${staySeconds} 秒结束`
    );

    addLog(
      `访问完成：${url}`
    );

    return {
      success: true
    };

  } catch (error) {

    addLog(
      `访问失败：${error.message}`,
      "error"
    );

    /*
     * 如果浏览器进程已经崩溃，
     * 清掉 context，让下一次访问可以重新启动。
     */

    if (
      error.message.includes(
        "Target page, context or browser has been closed"
      ) ||
      error.message.includes(
        "Browser has been closed"
      )
    ) {

      browserContext = null;

      addLog(
        "检测到 Chromium 已退出，将在下一次访问时重新启动",
        "error"
      );

    }

    return {
      success: false,
      error:
        error.message
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

    try {

      windowManagerProcess.kill();

    } catch (_) {
      // ignore
    }

    windowManagerProcess = null;
  }


  if (displayProcess) {

    try {

      displayProcess.kill();

    } catch (_) {
      // ignore
    }

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
