import { Logger } from '@nestjs/common';
import type { Page } from 'puppeteer';
import { config } from '../config';
import { sleep } from '@svinooh/common';
import { getBrowser, closeBrowser } from './browser';
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
 * EVM balance: a headless browser reads the rendered debank.com page — exactly
 * the one any anonymous visitor sees. This is the only path now; the signed HTTP
 * call to api.debank.com that used to front it 429'd from every datacenter IP
 * and was removed (see evm.ts).
 *
 * Reading the rendered page is exactly what a person does in a browser; no
 * signature is forged here, and all the code runs on debank.com's side. Slow
 * (20–40s), but it survives changes to their API.
 *
 * NEVER launch two headless browsers at once: parallel instances choke each
 * other and SILENTLY return $0 instead of the real balance. Below is browserLock
 * (Semaphore 1), so no matter how many EVM scans arrive at the same time, there
 * is always exactly one in the browser.
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
  // Idempotent: installed via evaluateOnNewDocument on Chrome, and re-run once
  // after navigation for lightpanda (which does not always honour it). The guard
  // makes the second call a no-op instead of double-wrapping fetch/XHR.
  if (window.__svinoohInstalled) return;
  window.__svinoohInstalled = true;
  const WANTED = ['/portfolio/project_list', '/portfolio/app_list', '/token/cache_balance_list'];
  const state = (window.__svinooh = {
    // Which profile the page is showing right now. Payloads for anybody else
    // are dropped: the tab is reused between wallets, and one wallet's
    // positions filed under another's address would be a silent, serious lie.
    expect: null,
    project_list: null,
    app_list: null,
    cache_balance_list: null,
    // When the page last asked the API for anything. While it is still
    // fetching, the number in the header is a subtotal, not a total.
    lastApiAt: 0,
  });
  window.__svinoohExpect = (address) => {
    state.expect = String(address || '').toLowerCase();
    state.project_list = state.app_list = state.cache_balance_list = null;
    state.lastApiAt = Date.now();
  };
  const noteApi = (url) => {
    if (String(url).indexOf('api.debank.com') !== -1) state.lastApiAt = Date.now();
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
    try { noteApi(String((args[0] && args[0].url) || args[0] || '')); } catch (e) {}
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
    try { noteApi(url); } catch (e) {}
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

/**
 * The debank.com responses seen during the current scan — status codes only, so
 * a failure can say WHY. A 429/403 is DeBank rate-limiting our IP (a proxy is
 * the fix); an empty trace next to a navigation timeout is the page never
 * answering at all — our own long-lived browser stalling, or an IP tarpit.
 * Reset at the start of each scan; only debank hosts are kept.
 */
let netTrace: Array<{ url: string; status: number }> = [];

function summarizeNet(trace: Array<{ url: string; status: number }>): string {
  if (!trace.length) return 'no debank responses seen';
  const byStatus = new Map<number, number>();
  for (const r of trace) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const counts = [...byStatus.entries()].map(([s, n]) => `${s}×${n}`).join(' ');
  const last = trace[trace.length - 1];
  return `${counts} (last ${last.status} ${last.url})`;
}

async function freshTab(): Promise<Page> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  // Record debank.com response codes, so a failed scan can be told apart:
  // 429/403 is DeBank; nothing at all is the page never answering. Best-effort —
  // if the engine emits no Network events, an empty trace is itself the signal.
  page.on('response', (res) => {
    try {
      const url = res.url();
      if (url.includes('debank.com')) {
        netTrace.push({ url: url.replace(/^https?:\/\//, '').slice(0, 80), status: res.status() });
        if (netTrace.length > 60) netTrace.shift();
      }
    } catch {
      // a response we cannot read tells us nothing; skip it
    }
  });
  // Best-effort: lightpanda does not implement setUserAgent/setViewport and logs
  // them as no-ops. Chrome honours both. Neither is load-bearing for the scan.
  await page
    .setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    )
    .catch(() => {});
  await page.setViewport({ width: 1440, height: 2000 }).catch(() => {});
  // Chrome runs this before the page's own scripts. lightpanda may skip it — the
  // scan re-injects (guarded) after navigation, so capture works either way.
  await page.evaluateOnNewDocument(INTERCEPT_SCRIPT).catch(() => {});
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

/** How the header total is read out of the page */
const READ_SETTLE_SCRIPT = String.raw`(() => {
  const el = document.querySelector('[class*="HeaderInfo_totalAssetInner"]');
  const m = ((el && el.innerText) || '').match(/\$([\d,]+(?:\.\d+)?)/);
  const s = window.__svinooh || {};
  return {
    total: m ? parseFloat(m[1].replace(/,/g, '')) : 0,
    quietMs: s.lastApiAt ? Date.now() - s.lastApiAt : 0,
  };
})()`;

/**
 * When the number in the header is the whole number.
 *
 * DeBank resolves chains one at a time and the header counts up as they land,
 * so reading it early does not give a slightly low figure — it gives a
 * different one. Measured on two real wallets: $64 four seconds in against
 * $29,462 a second later, and $3,616 against $27,667. Understating by eighty
 * times is not a rounding error, it is a wallet that looks emptied, and the
 * whole drop-confirmation machinery downstream exists to catch exactly that.
 *
 * Two signals, because neither is enough alone:
 *
 * - **The total stops moving.** The gaps between updates ran to 1.3s in those
 *   measurements, on a fast connection with a warm page; the old rule waited
 *   2.5s, which left about a second of margin. Five seconds is the plain,
 *   conservative answer.
 * - **The page stops asking.** Every intermediate reading came while the API
 *   had been quiet 0.3s or less; the final one landed 1.3s after the last
 *   request, and nothing was requested again for the next half minute. So
 *   three seconds of silence, with the total already still, says the same
 *   thing as five seconds of stillness — sooner.
 *
 * Whichever comes first, capped by `ceilingMs`, after which the last reading is
 * what we have. Never settles on zero: an empty header is a page that has not
 * started, not a wallet worth nothing.
 *
 * The cap is 30s and has to stay well under EVM_TIMEOUT_MS, which is the
 * watchdog for the whole scan: navigation, the selector wait and this all come
 * out of the same budget, and a settle that runs to its ceiling should still
 * leave room to finish rather than be killed one step from the answer.
 */
async function settledTotal(page: Page, ceilingMs = 30_000): Promise<number> {
  const STILL_MS = 5_000;
  const STILL_WITH_QUIET_MS = 2_000;
  const QUIET_MS = 3_000;
  const STEP_MS = 250;

  const deadline = Date.now() + ceilingMs;
  let total = 0;
  let unchangedSince = Date.now();

  while (Date.now() < deadline) {
    await sleep(STEP_MS);
    const { total: read, quietMs } = (await page.evaluate(READ_SETTLE_SCRIPT)) as {
      total: number;
      quietMs: number;
    };
    if (read !== total) {
      total = read;
      unchangedSince = Date.now();
      continue;
    }
    if (total <= 0) continue;
    const still = Date.now() - unchangedSince;
    if (still >= STILL_MS) break;
    if (still >= STILL_WITH_QUIET_MS && quietMs >= QUIET_MS) break;
  }
  return total;
}

async function dropTab(): Promise<void> {
  const page = tab;
  tab = null;
  tabScans = 0;
  await page?.close().catch(() => {});
}

export function scanEvmBrowser(
  address: string,
  opts: { patient?: boolean } = {},
): Promise<ScanResult> {
  // The lock wraps the actual work: while one scan holds the browser, the rest
  // wait here instead of launching a second browser
  return browserLock.run(() => scanEvmBrowserLocked(address, opts.patient ?? false));
}

async function scanEvmBrowserLocked(address: string, patient: boolean): Promise<ScanResult> {
  if (tab && (tab.isClosed() || tabScans >= SCANS_PER_TAB)) await dropTab();
  const firstLoad = tab === null;
  if (!tab) tab = await freshTab();
  const page = tab;
  tabScans++;
  netTrace = []; // scope the response trace to this scan

  // A patient pass (the retry from evm.ts) gives the two waits that actually
  // expire on heavy wallets more room: the navigation, and the wait for the
  // header total to render. A big wallet — the reference whale is 693 positions
  // across 60 API calls — can answer 200 to every one of them and still not have
  // painted the total inside 45s. The watchdog grows with them, so a
  // slow-but-fine render finishes instead of being killed one step short.
  const gotoTimeoutMs = patient ? 45_000 : 30_000;
  const selectorTimeoutMs = patient ? 60_000 : 45_000;
  const watchdogMs = config.evmTimeoutMs + (patient ? 30_000 : 0);

  // Safeguard against a hung page: on timeout the tab goes, and everything
  // pending on it rejects. The next scan opens a new one.
  const watchdog = setTimeout(() => void dropTab(), watchdogMs);

  try {
    // Tell the interceptor whose payloads to keep before anything is fetched
    await page.evaluate(`window.__svinoohExpect && window.__svinoohExpect(${JSON.stringify(address)})`);

    const hardLoad = async () => {
      await page.goto(`https://debank.com/profile/${address}`, {
        waitUntil: 'domcontentloaded',
        timeout: gotoTimeoutMs,
      });
      // lightpanda safety net: if evaluateOnNewDocument was skipped, install the
      // hooks now. The SPA fetches its portfolio after load, so this still lands
      // before the calls we care about. Guarded, so a no-op on Chrome.
      await page.evaluate(INTERCEPT_SCRIPT).catch(() => {});
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

    // The wait that expires when DeBank throttles us: the page still renders,
    // just slowly, and every hard failure we've had was this expiring. 45s
    // normally, 60s on a patient retry for a heavy wallet. The watchdog above is
    // the real ceiling.
    await page.waitForSelector('[class*="HeaderInfo_totalAssetInner"]', { timeout: selectorTimeoutMs });

    const totalUsd = await settledTotal(page);

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
          network: p.chain,
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
    const message = error instanceof Error ? error.message : String(error);
    // Say what debank actually returned, so the cause is diagnosable rather than
    // guessed: a 429/403 is DeBank throttling our IP (a proxy is the fix); an
    // empty trace is the page never answering (our browser stalling, or a tarpit).
    logger.warn(`${address}: browser scan failed (${message}) — debank ${summarizeNet(netTrace)}`);
    // Restart the WHOLE browser, not just the tab. If it is our long-lived
    // lightpanda process that has degraded, the next scan on a fresh one
    // succeeds; if it still fails on a brand-new browser (same egress IP), the
    // problem is DeBank / the IP, not us. Either way, the next attempt tells us.
    await dropTab();
    await closeBrowser();
    throw error;
  } finally {
    clearTimeout(watchdog);
  }
}
