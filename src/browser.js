const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");

const { addLog } = require("./logger");

let browser = null;
let context = null;

let xvfb = null;
let fluxbox = null;

let display = ":99";


/*
 * ============================
 * 启动 Xvfb
 * ============================
 */

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

  process.env.DISPLAY = display;

  console.log(
    `[Browser] Xvfb 启动完成：${display}`
  );

}


/*
 * ============================
 * 启动 Fluxbox
 * ============================
 */

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


/*
 * ============================
 * 启动浏览器
 * ============================
 */

async function ensureBrowser() {

  if (
    browser &&
    context
  ) {

    return;

  }

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
    "[Browser] 启动 Chromium"
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


/*
 * ============================
 * 清理错误信息
 *
 * 注意：
 * 网页日志绝对不能暴露
 * URL、密码、Token 等敏感信息。
 * ============================
 */

function sanitizeErrorMessage(error) {

  let message = "";

  if (
    error &&
    typeof error.message === "string"
  ) {

    message = error.message;

  } else if (
    typeof error === "string"
  ) {

    message = error;

  } else {

    message = "未知错误";

  }


  /*
   * 隐藏 URL
   */

  message =
    message.replace(
      /https?:\/\/[^\s"'<>]+/gi,
      "[目标地址]"
    );


  /*
   * 隐藏常见密码 / Token 参数
   */

  message =
    message.replace(
      /([?&](?:password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)=)[^&\s"'<>]*/gi,
      "$1[已隐藏]"
    );


  /*
   * 隐藏 password=xxx
   */

  message =
    message.replace(
      /\b(password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)\s*=\s*[^\s&"'<>]+/gi,
      "$1=[已隐藏]"
    );


  /*
   * 隐藏 Bearer Token
   */

  message =
    message.replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Bearer [已隐藏]"
    );


  /*
   * Playwright Call log
   *
   * Call log 里面可能再次出现完整 URL，
   * 所以直接截断。
   */

  const callLogIndex =
    message.indexOf(
      "\nCall log:"
    );

  if (
    callLogIndex !== -1
  ) {

    message =
      message.slice(
        0,
        callLogIndex
      );

  }


  /*
   * 防止错误信息过长
   */

  if (
    message.length > 500
  ) {

    message =
      message.slice(
        0,
        500
      ) +
      "...";

  }

  return (
    message.trim() ||
    "未知错误"
  );

}


/*
 * ============================
 * 访问网页
 * ============================
 */

async function visit(
  url,
  staySeconds = 10
) {

  /*
   * 确保浏览器已经启动
   */

  await ensureBrowser();


  /*
   * 网页日志：
   * 只显示安全的执行步骤。
   *
   * 绝对不把 url 写入 addLog()
   */

  addLog(
    "打开浏览器"
  );


  let page = null;

  try {

    page =
      await context.newPage();


    /*
     * Render 后台日志
     *
     * 不输出 URL
     */

    console.log(
      "[Browser] 开始执行网页访问"
    );


    /*
     * 网页日志
     */

    addLog(
      "正在访问目标网站"
    );


    /*
     * 实际访问
     *
     * URL 只传给 Playwright，
     * 不写入日志。
     */

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );


    /*
     * Render 后台日志
     */

    console.log(
      "[Browser] 页面加载完成"
    );


    /*
     * 网页日志
     */

    addLog(
      "页面加载完成"
    );


    /*
     * 停留时间
     */

    addLog(
      `停留 ${staySeconds} 秒`
    );


    if (
      staySeconds > 0
    ) {

      await page.waitForTimeout(
        staySeconds * 1000
      );

    }


    /*
     * Render 后台日志
     */

    console.log(
      "[Browser] 停留完成"
    );


    return {
      success: true
    };

  } catch (error) {

    /*
     * 只保留安全的错误信息
     */

    const reason =
      sanitizeErrorMessage(
        error
      );


    /*
     * 网页日志
     *
     * 不包含 URL
     */

    addLog(
      `访问失败：${reason}`,
      "error"
    );


    /*
     * Render 后台日志
     *
     * 同样不输出 URL。
     */

    console.error(
      `[Browser] 访问失败：${reason}`
    );


    return {
      success: false,
      error: reason
    };

  } finally {

    /*
     * 每次任务完成后关闭当前页面
     */

    if (page) {

      try {

        await page.close();

      } catch (error) {

        console.error(
          "[Browser] 页面关闭失败"
        );

      }

    }

  }

}


/*
 * ============================
 * 关闭浏览器
 * ============================
 */

async function closeBrowser() {

  console.log(
    "[Browser] 正在关闭浏览器..."
  );


  /*
   * 关闭 Chromium
   */

  if (context) {

    try {

      await context.close();

    } catch (error) {

      console.error(
        "[Browser] 关闭 Chromium 失败"
      );

    }

    context = null;

    browser = null;

  }


  /*
   * 关闭 Fluxbox
   */

  if (fluxbox) {

    try {

      fluxbox.kill();

    } catch {}

    fluxbox = null;

  }


  /*
   * 关闭 Xvfb
   */

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


/*
 * ============================
 * 导出
 * ============================
 */

module.exports = {
  visit,
  closeBrowser
};
