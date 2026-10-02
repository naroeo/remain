const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");

const { addLog } = require("./logger");

let browser = null;
let context = null;

let xvfb = null;
let fluxbox = null;

let display = ":99";


// =========================
// 启动 Xvfb
// =========================

async function startXvfb() {

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


  if (xvfb.stderr) {

    xvfb.stderr.on(
      "data",
      chunk => {

        console.error(
          "[Xvfb]",
          chunk.toString().trim()
        );

      }
    );

  }


  await new Promise(
    (resolve, reject) => {

      let finished = false;

      const timer =
        setTimeout(
          () => {

            if (finished) {
              return;
            }

            finished = true;

            resolve();

          },
          1000
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

          if (
            code !== null &&
            code !== 0
          ) {

            finished = true;

            clearTimeout(timer);

            reject(
              new Error(
                `Xvfb 启动失败，退出码 ${code}`
              )
            );

          }

        }
      );

    }
  );


  process.env.DISPLAY =
    display;


  console.log(
    `[Browser] Xvfb 启动完成：${display}`
  );

}


// =========================
// 启动 Fluxbox
// =========================

async function startFluxbox() {

  try {

    fluxbox = spawn(
      "fluxbox",
      [],
      {
        detached: false,
        stdio: "ignore"
      }
    );


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          500
        )
    );


    console.log(
      "[Browser] Fluxbox 启动完成"
    );

  } catch (error) {

    console.log(
      "[Browser] Fluxbox 启动失败，继续运行"
    );

  }

}


// =========================
// 启动浏览器
// =========================

async function ensureBrowser() {

  if (
    browser &&
    context
  ) {
    return;
  }


  /*
   * 不使用 Render 自带的 DISPLAY。
   *
   * 每次启动 Remain，
   * 自己启动 Xvfb。
   */

  await startXvfb();

  await startFluxbox();


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
    `[Browser] 启动 Chromium`
  );


  context =
    await chromium.launchPersistentContext(
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


  console.log(
    "[Browser] Chromium 启动成功"
  );

}


// =========================
// 获取访问错误
// =========================

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
      String(
        error.message
      );

  } else if (error) {

    message =
      String(error);

  }


  if (!message) {
    message = "未知错误";
  }


  /*
   * 日志里不直接显示完整 URL。
   */

  if (url) {

    message =
      message.split(
        String(url)
      ).join(
        "[目标 URL]"
      );

  }


  return message;

}


// =========================
// 访问网页
// =========================

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

        timeout:
          60000
      }
    );


    console.log(
      `[Browser] 页面加载完成：${url}`
    );


    if (
      staySeconds > 0
    ) {

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


// =========================
// 关闭浏览器
// =========================

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


  console.log(
    "[Browser] 浏览器已关闭"
  );

}


module.exports = {
  visit,
  closeBrowser
};
