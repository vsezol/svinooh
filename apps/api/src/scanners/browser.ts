import puppeteer, { Browser } from 'puppeteer';
import { config } from '../config';

/**
 * Один инстанс Chrome на весь сервис, страницы — по одной на скан.
 * Параллельные инстансы душат друг друга и МОЛЧА возвращают $0 вместо
 * реального баланса — без единой ошибки в логах. Поэтому браузер общий,
 * а конкурентность EVM-сканов жёстко ограничена единицей (см. ScanQueue).
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
      // прошлый запуск не удался — пробуем заново
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
    // уже закрыт или не поднялся
  }
}
