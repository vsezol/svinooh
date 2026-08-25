import { config } from '../config';
import { sleep } from '../common/util';
import { getBrowser } from './browser';
import { Semaphore } from './semaphore';
import type { ScanPosition, ScanResult } from './types';

/**
 * EVM FALLBACK: headless Chrome reads the rendered debank.com page — exactly
 * the one any anonymous visitor sees. The primary path is evm-http.ts (same
 * data, but straight over the API); we fall back here when the HTTP path fails
 * (stale signature, Cloudflare/IP ban, undercounted total).
 *
 * Reading the rendered page is exactly what a person does in a browser; no
 * signature is forged here, and all the code runs on debank.com's side. Slow
 * (20–40s), but it survives changes to their API.
 *
 * NEVER launch two headless Chrome instances at once: parallel instances choke
 * each other and SILENTLY return $0 instead of the real balance. Below is
 * browserLock (Semaphore 1), so no matter how many EVM scans fall back to
 * Chrome at the same time, there is always exactly one in the browser.
 *
 * The page code is passed as STRINGS, not functions: esbuild/tsx with keepNames
 * injects a __name helper into serialized functions that isn't present in the
 * page context — evaluate then fails silently. Strings don't depend on the
 * transpiler.
 */

// The one service-wide browser lock — guarantees "never two Chrome at once"
const browserLock = new Semaphore(1);

const READ_TOTAL_SCRIPT = String.raw`(() => {
  const el = document.querySelector('[class*="HeaderInfo_totalAssetInner"]');
  const match = ((el && el.innerText) || '').match(/\$([\d,]+(?:\.\d+)?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
})()`;

// Expand collapsed chains ("Unfold N chains") so the breakdown is complete
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
  // The lock wraps the actual work: while one scan holds the browser, the rest
  // wait here instead of launching a second Chrome
  return browserLock.run(() => scanEvmBrowserLocked(address));
}

async function scanEvmBrowserLocked(address: string): Promise<ScanResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  // Safeguard against a hung page: on timeout we close it, and all pending
  // operations are rejected
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

    // DeBank loads chains one at a time, and the total grows as each resolves.
    // Reading right after waitForSelector yields an understated number:
    // we wait for 5 identical non-zero readings in a row, 500ms apart.
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

    // Positions and the per-chain breakdown are best-effort: if DeBank changes
    // its markup, the total stays correct, there just won't be any positions
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
      // markup drifted — work with the total alone
    }

    return { chain: 'EVM', address, totalUsd, positions, breakdown };
  } finally {
    clearTimeout(watchdog);
    await page.close().catch(() => {});
  }
}
