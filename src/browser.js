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
============================
启动 Xvfb
============================
*/

async function startXvfb() {
  console.log(`[Browser] 正在启动 Xvfb：${display}`);

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
        /*
         * Xvfb 自身错误不包含任务 URL，
         * 可以正常输出。
         */
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

      const timer = setTimeout(
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
============================
启动 Fluxbox
============================
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
      resolve => {
        setTimeout(
          resolve,
          500
        );
      }
    );

    console.log(
      "[Browser] Fluxbox 启动完成"
    );

  } catch (error) {
    /*
     * Fluxbox 失败不影响后续继续尝试启动 Chromium。
     *
     * 不输出原始 error，
     * 避免第三方程序错误信息中带出意外内容。
     */
    console.log(
      "[Browser] Fluxbox 启动失败，继续运行"
    );
  }
}


/*
============================
启动 Chromium
============================
*/

async function ensureBrowser() {
  if (
    browser &&
    context
  ) {
    return;
  }

  /*
   * 不使用 Render 可能存在的 DISPLAY。
   *
   * 保持原来的逻辑：
   * 每次自己启动 Xvfb :99。
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
============================
安全处理错误信息
============================

这里非常重要。

Playwright 的 error.message
有可能包含：

- 完整 URL
- query 参数
- redirect 参数
- 页面地址
- 其他导航信息

所以不能直接：

console.error(error)

也不能直接：

addLog(error.message)

必须先清理。
============================
*/

function sanitizeErrorMessage(
  error
) {
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
   * 去掉常见的完整 URL。
   *
   * 例如：
   *
   * https://example.com/login?password=123
   *
   * 会变成：
   *
   * [目标地址]
   */
  message =
    message.replace(
      /https?:\/\/[^\s"'<>]+/gi,
      "[目标地址]"
    );

  /*
   * 清理可能出现的 URL 参数。
   *
   * 即使 URL 没有被完整匹配，
   * 也不要让 password/token/key/secret
   * 之类的参数进入日志。
   */
  message =
    message.replace(
      /([?&](?:password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)=)[^&\s"'<>]*/gi,
      "$1[已隐藏]"
    );

  /*
   * 清理常见的：
   *
   * password=xxx
   * token=xxx
   * secret=xxx
   *
   * 即使前面不是 ? 或 &，
   * 也进行隐藏。
   */
  message =
    message.replace(
      /\b(password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)\s*=\s*[^\s&"'<>]+/gi,
      "$1=[已隐藏]"
    );

  /*
   * 清理 Bearer Token。
   */
  message =
    message.replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Bearer [已隐藏]"
    );

  /*
   * Playwright 错误中可能出现非常长的
   * Call log。
   *
   * 这里保留必要原因，但去掉
   * 可能携带页面内容的后续细节。
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
   * 防止错误信息过长。
   */
  if (
    message.length > 500
  ) {
    message =
      message.slice(
        0,
        500
      ) + "...";
  }

  return (
    message.trim() ||
    "未知错误"
  );
}


/*
============================
访问网页
============================
*/

async function visit(
  url,
  staySeconds = 10
) {
  await ensureBrowser();

  let page = null;

  try {
    page =
      await context.newPage();

    /*
     * 注意：
     *
     * 这里故意不打印 URL。
     *
     * 以前：
     *
     * console.log(
     *   `[Browser] 开始访问：${url}`
     * );
     *
     * 现在完全删除。
     */

    console.log(
      "[Browser] 开始执行网页访问"
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
      "[Browser] 页面加载完成"
    );

    if (
      staySeconds > 0
    ) {
      await page.waitForTimeout(
        staySeconds * 1000
      );
    }

    console.log(
      "[Browser] 停留完成"
    );

    return {
      success: true
    };

  } catch (error) {
    /*
     * 只提取并清理错误原因。
     *
     * 不再：
     *
     * console.error(
     *   "[Browser] Visit error:",
     *   error
     * );
     *
     * 因为原始 Playwright error
     * 可能包含完整 URL。
     */

    const reason =
      sanitizeErrorMessage(
        error
      );

    /*
     * 前端日志：
     *
     * 只显示安全后的错误原因。
     */
    addLog(
      `访问失败：${reason}`,
      "error"
    );

    /*
     * Render 控制台：
     *
     * 同样只输出安全后的原因。
     */
    console.error(
      `[Browser] 访问失败：${reason}`
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
        /*
         * 页面关闭失败也不输出原始 error。
         */
        console.error(
          "[Browser] 页面关闭失败"
        );
      }
    }
  }
}


/*
============================
关闭浏览器
============================
*/

async function closeBrowser() {
  console.log(
    "[Browser] 正在关闭浏览器..."
  );

  if (context) {
    try {
      await context.close();

    } catch (error) {
      /*
       * 不输出原始错误。
       */
      console.error(
        "[Browser] 关闭 Chromium 失败"
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
