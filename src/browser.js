const {
  chromium
} = require("playwright");

const {
  spawn
} = require("child_process");

const fs = require("fs");
const path = require("path");

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

function startDisplay() {

  if (displayProcess) {
    return;
  }

  console.log(
    "[Browser] Starting Xvfb..."
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

function startWindowManager() {

  if (windowManagerProcess) {
    return;
  }

  console.log(
    "[Browser] Starting Fluxbox..."
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

  console.log(
    "[Browser] Starting headed Chromium..."
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

  console.log(
    "[Browser] Chromium started"
  );

  return browserContext;
}

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
      page = await context.newPage();
    }

    console.log(
      `[Browser] Opening ${url}`
    );

    await page.goto(
      url,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    console.log(
      `[Browser] Page loaded: ${url}`
    );

    await page.waitForTimeout(
      staySeconds * 1000
    );

    console.log(
      `[Browser] Finished: ${url}`
    );

    return {
      success: true
    };

  } catch (error) {

    console.error(
      `[Browser] Error: ${error.message}`
    );

    return {
      success: false,
      error: error.message
    };
  }
}

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
}

module.exports = {
  visit,
  closeBrowser
};
