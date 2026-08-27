import { Logger } from '@nestjs/common';
import type { Page } from 'puppeteer';
import { config } from '../config';
import { sleep } from '@svinooh/common';
import { getBrowser } from './browser';
import {
  itemPositions,
  tokenPosition,
  type AppListResponse,
  type DebankProject,
  type DebankToken,
} from './debank-portfolio';
import { Semaphore } from '@svinooh/common';
import type { ScanPosition, ScanResult } from '@svinooh/shared';

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
  const state = (window.__svinooh = {
    // Which profile the page is showing right now. Payloads for anybody else
    // are dropped: the tab is reused between wallets, and one wallet's
    // positions filed under another's address would be a silent, serious lie.
    expect: null,
    project_list: null,
    app_list: null,
    cache_balance_list: null,
  });
  window.__svinoohExpect = (address) => {
    state.expect = String(address || '').toLowerCase();
    state.project_list = state.app_list = state.cache_balance_list = null;
  };
  const keyOf = (url) => {
    for (const path of WANTED) if (url.indexOf(path) !== -1) return path.split('/').pop();
    return null;
  };
  const save = (url, text) => {
    const key = keyOf(url);
    if (!key) return;
    if (state.expect && String(url).toLowerCase().indexOf(state.expect) === -1) return;
    try {
      const body = JSON.parse(text);
      if (body && body.error_code === 0 && 'data' in body) state[key] = body.data;
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

/**
 * One tab, reused.
 *
 * Loading debank.com from scratch for every wallet was most of what the scanner
 * cost: a full SPA boot, its bundle, its fonts, its images, ten seconds of
 * layout — to read three JSON payloads the page fetches for itself. The tab now
 * stays open and moves between profiles the way a person clicking a link does,
 * so all of that is paid once instead of once per wallet.
 *
 * It is recycled every so often anyway. A tab kept forever is a leak waiting to
 * be discovered, and starting fresh is cheap when it happens on a schedule
 * rather than on every scan.
 */
const SCANS_PER_TAB = 40;

const logger = new Logger('EvmBrowser');

let tab: Page | null = null;
let tabScans = 0;

async function freshTab(): Promise<Page> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  );
  await page.setViewport({ width: 1440, height: 2000 });
  // Has to be in place before the page's own scripts run
  await page.evaluateOnNewDocument(INTERCEPT_SCRIPT);
  return page;
}

/**
 * Waits for the page to have fetched the payloads we actually want.
 *
 * Everything downstream degrades quietly without them: the total is still
 * right, because that is scraped from the header, but the positions come from
 * the DOM instead — protocol totals with no legs, no APY, no health factor —
 * and nothing in the result says so. Waiting is cheap; noticing afterwards that
 * a month of history has no detail in it is not.
 */
async function waitForCapture(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate('!!(window.__svinooh && window.__svinooh.project_list)')) return true;
    await sleep(400);
  }
  return false;
}

async function dropTab(): Promise<void> {
  const page = tab;
  tab = null;
  tabScans = 0;
  await page?.close().catch(() => {});
}

export function scanEvmBrowser(address: string): Promise<ScanResult> {
  // The lock wraps the actual work: while one scan holds the browser, the rest
  // wait here instead of launching a second Chrome
  return browserLock.run(() => scanEvmBrowserLocked(address));
}

async function scanEvmBrowserLocked(address: string): Promise<ScanResult> {
  if (tab && (tab.isClosed() || tabScans >= SCANS_PER_TAB)) await dropTab();
  const firstLoad = tab === null;
  if (!tab) tab = await freshTab();
  const page = tab;
  tabScans++;

  // Safeguard against a hung page: on timeout the tab goes, and everything
  // pending on it rejects. The next scan opens a new one.
  const watchdog = setTimeout(() => void dropTab(), config.evmTimeoutMs);

  try {
    // Tell the interceptor whose payloads to keep before anything is fetched
    await page.evaluate(`window.__svinoohExpect && window.__svinoohExpect(${JSON.stringify(address)})`);

    const hardLoad = async () => {
      await page.goto(`https://debank.com/profile/${address}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.evaluate(`window.__svinoohExpect && window.__svinoohExpect(${JSON.stringify(address)})`);
    };

    if (firstLoad) {
      await hardLoad();
    } else {
      // The same move a click makes: the app re-fetches for the new profile,
      // signing the requests itself, and the interceptor keeps the answers
      await page.evaluate(
        `(() => { history.pushState({}, '', '/profile/' + ${JSON.stringify(address)}); window.dispatchEvent(new PopStateEvent('popstate')); })()`,
      );
      await page.evaluate(`window.__svinoohExpect(${JSON.stringify(address)})`);

      // The app keeps what it has already fetched, so navigating back to an
      // address it has seen answers from memory and asks the network for
      // nothing. Our interceptor stays empty and we would quietly fall back to
      // scraping the DOM — the same total, far less detail, and no sign that
      // anything was lost. So: wait for the payloads, and if they never come,
      // load the page properly.
      if (!(await waitForCapture(page, 12_000))) {
        logger.debug?.(`${address}: nothing intercepted after the in-page move — reloading`);
        await hardLoad();
      }
    }

    // 45s, not 25s: when DeBank throttles us the page still renders, just
    // slowly, and every hard failure we've had was this wait expiring. The
    // watchdog above is the real ceiling.
    await page.waitForSelector('[class*="HeaderInfo_totalAssetInner"]', { timeout: 45_000 });

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

    // A cold load is slower than the total settling, so the payloads may still
    // be in flight — give them a moment before deciding they aren't coming
    await waitForCapture(page, 10_000);

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
  } catch (error) {
    // A tab that failed once is not to be trusted with the next wallet
    await dropTab();
    throw error;
  } finally {
    clearTimeout(watchdog);
  }
}
