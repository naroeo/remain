const { chromium } = require("playwright");

let browser = null;
let context = null;

async function getContext() {
  if (context) {
    return context;
  }

  browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 720
    }
  });

  return context;
}

async function visit(url, staySeconds = 10) {
  const ctx = await getContext();

  const page = await ctx.newPage();

  try {
    console.log(`[Browser] Opening ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(
      staySeconds * 1000
    );

    console.log(`[Browser] Finished ${url}`);

    return {
      success: true
    };

  } catch (error) {

    console.error(
      `[Browser] ${url}`,
      error.message
    );

    return {
      success: false,
      error: error.message
    };

  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
  }
}

module.exports = {
  visit,
  closeBrowser
};
