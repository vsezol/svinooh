import { config } from '../config';
import { sleep } from '../common/util';
import { getBrowser } from './browser';
import { Semaphore } from './semaphore';
import type { ScanPosition, ScanResult } from './types';

/**
 * EVM-ФОЛЛБЭК: headless Chrome читает отрисованную страницу debank.com —
 * ровно ту же, что видит любой анонимный посетитель. Первичный путь —
 * evm-http.ts (те же данные, но напрямую по API); сюда откатываемся, если
 * HTTP осёкся (подпись протухла, Cloudflare/IP-бан, недобор суммы).
 *
 * Читать отрисованную страницу — это ровно то, что делает человек в
 * браузере; здесь не подделывается никакая подпись, весь код исполняется на
 * стороне debank.com. Медленно (20–40с), но переживает смену их API.
 *
 * НИКОГДА не запускать два headless Chrome разом: параллельные инстансы
 * душат друг друга и МОЛЧА возвращают $0 вместо реального баланса. Ниже —
 * browserLock (Semaphore 1), поэтому сколько бы EVM-сканов ни откатилось на
 * Chrome одновременно, в браузере всегда ровно один.
 *
 * Код для странички передаётся СТРОКАМИ, а не функциями: esbuild/tsx с
 * keepNames вставляет в сериализованные функции хелпер __name, которого нет
 * в контексте страницы — evaluate тогда молча падает. Строки от
 * транспилятора не зависят.
 */

// Единственный на весь сервис лок браузера — гарантия «не два Chrome разом»
const browserLock = new Semaphore(1);

const READ_TOTAL_SCRIPT = String.raw`(() => {
  const el = document.querySelector('[class*="HeaderInfo_totalAssetInner"]');
  const match = ((el && el.innerText) || '').match(/\$([\d,]+(?:\.\d+)?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
})()`;

// Раскрыть свёрнутые сети ("Unfold N chains"), чтобы разбивка была полной
const UNFOLD_CHAINS_SCRIPT = String.raw`(() => {
  for (const el of document.querySelectorAll('[class*="AssetsOnChain"]')) {
    if (/^Unfold/i.test((el.textContent || '').trim())) {
      el.click();
      return true;
    }
  }
  return false;
})()`;

const EXTRACT_SCRIPT = String.raw`(() => {
  const parseUsd = (s) => {
    const match = (s || '').match(/\$([\d,]+(?:\.\d+)?)/);
    return match ? parseFloat(match[1].replace(/,/g, '')) : null;
  };
  const parseNum = (s) => {
    const match = (s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  };

  const tokens = [];
  const container = document.querySelector('[class*="TokenWallet_container"]');
  if (container) {
    for (const row of container.querySelectorAll('.db-table-row')) {
      const cells = Array.from(row.querySelectorAll('.db-table-cell')).map((c) => (c.innerText || '').trim());
      if (cells.length < 4) continue;
      const symbol = (cells[0] || '').split('\n')[0].trim();
      const valueUsd = parseUsd(cells[3]);
      if (!symbol || valueUsd === null) continue;
      tokens.push({ symbol, priceUsd: parseUsd(cells[1]), amount: parseNum(cells[2]), valueUsd });
    }
  }

  const projects = [];
  for (const card of document.querySelectorAll('[class*="Project_project"]')) {
    const nameEl = card.querySelector('[class*="ProjectTitle_name"]');
    const name = nameEl ? (nameEl.innerText || '').trim() : '';
    const numberEl = card.querySelector('.projectTitle-number');
    const valueUsd = parseUsd(numberEl ? numberEl.innerText : '');
    if (!name || valueUsd === null) continue;
    const chainImg = card.querySelector('[class*="ProjectTitle_projectChain"] img');
    projects.push({ name, chain: (chainImg && chainImg.getAttribute('alt')) || null, valueUsd });
  }

  const chains = [];
  for (const item of document.querySelectorAll('[class*="AssetsOnChain_item"]')) {
    const lines = (item.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const usdLine = lines.find((l) => l.indexOf('$') === 0);
    const usd = parseUsd(usdLine);
    if (lines[0] && usd !== null) chains.push({ name: lines[0], usd });
  }

  return { tokens, projects, chains };
})()`;

interface ExtractedData {
  tokens: Array<{ symbol: string; priceUsd: number | null; amount: number | null; valueUsd: number }>;
  projects: Array<{ name: string; chain: string | null; valueUsd: number }>;
  chains: Array<{ name: string; usd: number }>;
}

export function scanEvmBrowser(address: string): Promise<ScanResult> {
  // Лок — снаружи собственно работы: пока один скан держит браузер, остальные
  // ждут здесь, а не запускают второй Chrome
  return browserLock.run(() => scanEvmBrowserLocked(address));
}

async function scanEvmBrowserLocked(address: string): Promise<ScanResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  // Страховка от зависшей страницы: по таймауту закрываем её, и все висящие
  // операции отклоняются
  const watchdog = setTimeout(() => void page.close().catch(() => {}), config.evmTimeoutMs);

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 1440, height: 2000 });
    await page.goto(`https://debank.com/profile/${address}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForSelector('[class*="HeaderInfo_totalAssetInner"]', { timeout: 25_000 });

    // DeBank догружает сети по очереди, и тотал растёт по мере резолва каждой.
    // Читать сразу после waitForSelector — получить заниженное число:
    // ждём 5 одинаковых ненулевых замеров подряд с шагом 500мс.
    let totalUsd = 0;
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      totalUsd = (await page.evaluate(READ_TOTAL_SCRIPT)) as number;
      if (totalUsd > 0 && totalUsd === last) {
        if (++stable >= 5) break;
      } else {
        stable = 0;
      }
      last = totalUsd;
    }

    // Позиции и разбивка по сетям — best-effort: если DeBank поменяет вёрстку,
    // тотал всё равно останется корректным, просто позиций не будет
    let positions: ScanPosition[] = [];
    let breakdown: Record<string, number> | undefined;
    try {
      await page.evaluate(UNFOLD_CHAINS_SCRIPT);
      await sleep(500);
      const data = (await page.evaluate(EXTRACT_SCRIPT)) as ExtractedData;
      positions = [
        ...data.projects.map((p) => ({
          symbol: p.name,
          name: p.chain,
          valueUsd: p.valueUsd,
          platform: 'debank',
          category: 'defi' as const,
        })),
        ...data.tokens.map((t) => ({
          symbol: t.symbol,
          amount: t.amount,
          priceUsd: t.priceUsd,
          valueUsd: t.valueUsd,
          platform: 'wallet',
          category: 'token' as const,
        })),
      ];
      if (data.chains.length) {
        breakdown = {};
        for (const chain of data.chains) breakdown[chain.name] = chain.usd;
      }
    } catch {
      // вёрстка уехала — работаем с одним тоталом
    }

    return { chain: 'EVM', address, totalUsd, positions, breakdown };
  } finally {
    clearTimeout(watchdog);
    await page.close().catch(() => {});
  }
}
