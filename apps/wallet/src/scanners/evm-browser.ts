import { config } from '../config';
import { sleep } from '../common/util';
import { getBrowser } from './browser';
import {
  itemPositions,
  tokenPosition,
  type AppListResponse,
  type DebankProject,
  type DebankToken,
} from './debank-portfolio';
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

/**
 * Installed before navigation: records the JSON of the portfolio calls the page
 * makes for itself. That's the same payload the signed HTTP path fetches — with
 * the per-item legs (supplied / rewards / debt) that the rendered DOM never
 * shows — obtained without a single extra request or signature of our own. It
 * matters because from a datacenter IP the direct API call is the thing that
 * gets rate-limited, while the page's own requests keep working.
 */
const INTERCEPT_SCRIPT = String.raw`(() => {
  const WANTED = ['/portfolio/project_list', '/portfolio/app_list', '/token/cache_balance_list'];
  const store = (window.__svinooh = { project_list: null, app_list: null, cache_balance_list: null });
  const keyOf = (url) => {
    for (const path of WANTED) if (url.indexOf(path) !== -1) return path.split('/').pop();
    return null;
  };
  const save = (url, text) => {
    const key = keyOf(url);
    if (!key) return;
    try {
      const body = JSON.parse(text);
      if (body && body.error_code === 0 && 'data' in body) store[key] = body.data;
    } catch (e) {}
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then((res) => {
      try {
        const url = String((args[0] && args[0].url) || args[0] || '');
        if (keyOf(url)) res.clone().text().then((t) => save(url, t)).catch(() => {});
      } catch (e) {}
      return res;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('load', () => {
      try {
        save(String(url), this.responseText);
      } catch (e) {}
    });
    return originalOpen.apply(this, arguments);
  };
})()`;

const READ_CAPTURE_SCRIPT = 'window.__svinooh || null';

interface Capture {
  project_list: DebankProject[] | null;
  app_list: AppListResponse | null;
  cache_balance_list: DebankToken[] | null;
}

/**
 * Positions from the intercepted API payloads. Returns null when the page
 * didn't get far enough (DeBank still loading, markup/endpoints changed) — the
 * caller then falls back to what it scraped from the DOM.
 *
 * The scraped header total stays the authority either way: it's the number
 * DeBank itself displays, and these payloads only fill in the detail behind it.
 */
function positionsFromCapture(capture: Capture | null): ScanPosition[] | null {
  const projects = capture?.project_list;
  if (!Array.isArray(projects)) return null;

  const positions: ScanPosition[] = [];
  for (const project of projects) positions.push(...itemPositions(project));
  for (const app of capture?.app_list?.apps || []) positions.push(...itemPositions(app));
  for (const token of capture?.cache_balance_list || []) {
    const position = tokenPosition(token);
    if (position) positions.push(position);
  }
  return positions.length ? positions : null;
}

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
    // Has to be in place before the page's own scripts run
    await page.evaluateOnNewDocument(INTERCEPT_SCRIPT);
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
      // Preferred: the JSON the page fetched for itself — protocol positions
      // split by kind, with their supply/reward/borrow legs. The scraped DOM is
      // the fallback: correct values, but protocol totals only.
      const captured = positionsFromCapture((await page.evaluate(READ_CAPTURE_SCRIPT)) as Capture | null);
      positions = captured ?? [
        ...data.projects.map((p) => ({
          symbol: p.name,
          note: p.chain,
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
