const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");

const { addLog } = require("./logger");

let browser = null;
let context = null;

let xvfb = null;
let fluxbox = null;
let display = null;


/* =========================================================
   检查系统命令
   ========================================================= */

function commandExists(command) {
  try {
    execFileSync(
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


/* =========================================================
   检查 DISPLAY 是否真的可用
   ========================================================= */

function displayIsAvailable(displayName) {
  if (!displayName) {
    return false;
  }

  if (!commandExists("xdpyinfo")) {
    return false;
  }

  try {
    execFileSync(
      "xdpyinfo",
      ["-display", displayName],
      {
        stdio: "ignore",
        timeout: 3000
      }
    );

    return true;
  } catch {
    return false;
  }
}


/* =========================================================
   启动 Xvfb
   ========================================================= */

async function startXvfb() {
  if (!commandExists("Xvfb")) {
    throw new Error(
      "系统未安装 Xvfb"
    );
  }

  /*
   * Render 环境中使用 :99。
   */
  const displayNumber = 99;

  display = `:${displayNumber}`;

  /*
   * 如果 :99 已经被占用，先尝试使用。
   */
  if (displayIsAvailable(display)) {
    process.env.DISPLAY = display;

    console.log(
      `[Browser] 使用已有 X Server：${display}`
    );

    return;
  }

  console.log(
    `[Browser] 正在启动 Xvfb：${display}`
  );

  xvfb = spawn(
    "Xvfb",
    [
      display,
      "-screen",
      "0",
      "1920x1080x24",
      "-ac",
      "-nolisten",
      "tcp"
    ],
    {
      detached: false,
      stdio: [
        "ignore",
        "ignore",
        "pipe"
      ]
    }
  );

  let xvfbError = "";

  if (xvfb.stderr) {
    xvfb.stderr.on(
      "data",
      chunk => {
        xvfbError += chunk.toString();
      }
    );
  }

  await new Promise(
    (resolve, reject) => {
      let finished = false;

      const timer =
        setTimeout(
          () => {
            if (!finished) {
              finished = true;
              resolve();
            }
          },
          1500
        );

      xvfb.once(
        "error",
        error => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(timer);

          reject(error);
        }
      );

      xvfb.once(
        "exit",
        code => {
          if (finished) {
            return;
          }

          /*
           * Xvfb 很快退出说明启动失败。
           */
          if (code !== null && code !== 0) {
            finished = true;

            clearTimeout(timer);

            reject(
              new Error(
                `Xvfb 启动失败，退出码 ${code}` +
                (
                  xvfbError
                    ? `：${xvfbError.trim()}`
                    : ""
                )
              )
            );
          }
        }
      );
    }
  );

  process.env.DISPLAY = display;

  /*
   * 再确认一次 X Server。
   */
  if (!displayIsAvailable(display)) {
    throw new Error(
      `Xvfb 已启动，但 DISPLAY ${display} 不可用`
    );
  }

  console.log(
    `[Browser] Xvfb 启动成功：${display}`
  );
}


/* =========================================================
   启动 Fluxbox
   ========================================================= */

async function startFluxbox() {
  if (!commandExists("fluxbox")) {
    console.log(
      "[Browser] 未找到 fluxbox，继续运行"
    );

    return;
  }

  /*
   * Fluxbox 只是提供窗口管理器，
   * Playwright 本身并不依赖它才能访问网页。
   */
  fluxbox = spawn(
    "fluxbox",
    [],
    {
      detached: false,
      stdio: "ignore"
    }
  );

  await new Promise(
    resolve => {
      setTimeout(
        resolve,
        500
      );
    }
  );

  console.log(
    "[Browser] Fluxbox 启动成功"
  );
}


/* =========================================================
   确保显示环境
   ========================================================= */

async function ensureDisplay() {
  /*
   * 不再单纯相信 process.env.DISPLAY。
   *
   * 必须确认这个 DISPLAY 背后真的有 X Server。
   */
  if (
    process.env.DISPLAY &&
    displayIsAvailable(
      process.env.DISPLAY
    )
  ) {
    display =
      process.env.DISPLAY;

    console.log(
      `[Browser] 使用现有 DISPLAY：${display}`
    );

    return;
  }

  /*
   * 如果 DISPLAY 存在但 X Server 不存在，
   * 清掉它，避免 Chromium 继续使用坏的 DISPLAY。
   */
  if (process.env.DISPLAY) {
    console.log(
      `[Browser] DISPLAY ${process.env.DISPLAY} 不可用，启动 Xvfb`
    );

    delete process.env.DISPLAY;
  }

  await startXvfb();

  await startFluxbox();
}


/* =========================================================
   确保浏览器
   ========================================================= */

async function ensureBrowser() {
  if (browser && context) {
    return;
  }

  await ensureDisplay();

  const userDataDir =
    process.env.PLAYWRIGHT_USER_DATA_DIR ||
    "/tmp/remain-playwright";

  fs.mkdirSync(
    userDataDir,
    {
      recursive: true
    }
  );

  console.log(
    `[Browser] 当前 DISPLAY：${process.env.DISPLAY}`
  );

  console.log(
    `[Browser] 启动 Chromium，用户目录：${userDataDir}`
  );

  context =
    await chromium.launchPersistentContext(
      userDataDir,
      {
        /*
         * Render 上通过 Xvfb 提供虚拟显示器，
         * 所以这里继续使用 headed 模式。
         */
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

  console.log(
    "[Browser] Chromium 启动成功"
  );
}


/* =========================================================
   处理访问错误
   ========================================================= */

function getVisitErrorMessage(
  error,
  url
) {
  let message = "";

  if (
    error &&
    error.message
  ) {
    message =
      String(error.message);
  } else if (error) {
    message =
      String(error);
  }

  if (!message) {
    message = "未知错误";
  }

  /*
   * 不在日志中重复显示完整 URL。
   */
  if (url) {
    message =
      message
        .split(String(url))
        .join("[目标 URL]");
  }

  return message;
}


/* =========================================================
   访问网页
   ========================================================= */

async function visit(
  url,
  staySeconds = 10
) {
  await ensureBrowser();

  let page = null;

  try {
    page =
      await context.newPage();

    console.log(
      `[Browser] 开始访问：${url}`
    );

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

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
    const reason =
      getVisitErrorMessage(
        error,
        url
      );

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


/* =========================================================
   关闭浏览器
   ========================================================= */

async function closeBrowser() {
  console.log(
    "[Browser] 正在关闭浏览器..."
  );

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

  console.log(
    "[Browser] 浏览器已关闭"
  );
}


/* =========================================================
   Export
   ========================================================= */

module.exports = {
  visit,
  closeBrowser
};
