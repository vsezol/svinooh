import puppeteer, { Browser } from 'puppeteer';
import { config } from '../config';

/**
 * One Chrome instance for the whole service, one page per scan.
 * Parallel instances choke each other and SILENTLY return $0 instead of the
 * real balance — without a single error in the logs. So the browser is shared,
 * and EVM scan concurrency is hard-capped at one (see ScanQueue).
 */
let browserPromise: Promise<Browser> | null = null;

function launch(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: config.puppeteerExecutablePath || undefined,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...(config.chromeNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  });
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.connected) return browser;
      await browser.close().catch(() => {});
    } catch {
      // the previous launch failed — try again
    }
  }
  browserPromise = launch();
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    await (await pending).close();
  } catch {
    // already closed or never came up
  }
}
