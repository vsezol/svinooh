import { debank, DebankError } from './debank-client';
import {
  itemPositions,
  projectNetUsd,
  tokenPosition,
  type AppListResponse,
  type DebankProject,
  type DebankToken,
} from './debank-portfolio';
import type { ScanPosition, ScanResult } from '@svinooh/shared';

/**
 * EVM balance via the debank.com web API (reverse-engineered signature, see
 * debank-client.ts). Fast primary path; on any miss evm.ts falls back to Chrome.
 *
 * DeBank's header total = the sum of THREE non-overlapping sources, exactly the
 * way the DeBank front end adds them up:
 *   1) project_list — on-chain DeFi (Aave, GMX, Pendle…)    user_addr
 *   2) app_list     — "apps" (Hyperliquid, etc.)            user_id
 *   3) cache_balance_list — tokens held                     user_addr
 * Skip app_list and you silently lose Hyperliquid (on the reference wallet
 * that's $3,512 of $27,485). So all three are required, not "pick one".
 *
 * The payloads are parsed in debank-portfolio.ts, shared with the Chrome path.
 *
 * Cross-check: total_net_curve (the historical curve, which excludes apps).
 * If our sum is more than 10% below the curve's last point, we've dropped
 * on-chain value that DeBank can see → that's a miss, fall back to Chrome
 * rather than writing an understated number into the history.
 */

interface NetCurve {
  usd_value_list?: Array<[number, number]>;
}

function addChain(breakdown: Record<string, number>, chain: string | undefined, usd: number): void {
  const key = chain || 'other';
  breakdown[key] = (breakdown[key] || 0) + usd;
}

export async function scanEvmHttp(rawAddress: string): Promise<ScanResult> {
  const address = rawAddress.toLowerCase(); // the DeBank API rejects checksummed casing
  const client = debank();

  // Sequentially, not Promise.all: three concurrent signed requests hit
  // api.debank.com's burst limit (a reliable 429 on the third, cache_balance),
  // especially from a datacenter IP. A background scan's latency isn't critical.
  const projects = await client.get<DebankProject[]>('/portfolio/project_list', { user_addr: address });
  const appList = await client.get<AppListResponse>('/portfolio/app_list', { user_id: address });
  const tokens = await client.get<DebankToken[]>('/token/cache_balance_list', { user_addr: address });

  // DeBank couldn't finish loading some apps → our sum is incomplete → fall back
  if (appList?.error_apps?.length) {
    throw new DebankError(`app_list returned ${appList.error_apps.length} error_apps — total is incomplete`);
  }

  const positions: ScanPosition[] = [];
  const breakdown: Record<string, number> = {};

  // 1) On-chain DeFi by protocol — expanded down to individual positions
  let defiProjects = 0;
  for (const project of projects || []) {
    const usd = projectNetUsd(project);
    if (usd < 0.01) continue;
    defiProjects += usd;
    addChain(breakdown, project.chain, usd);
    positions.push(...itemPositions(project));
  }

  // 2) Apps (Hyperliquid, etc.) — the same shape, a separate endpoint
  let defiApps = 0;
  for (const app of appList?.apps || []) {
    const usd = projectNetUsd(app);
    if (usd < 0.01) continue;
    defiApps += usd;
    addChain(breakdown, app.chain || app.id, usd);
    positions.push(...itemPositions(app));
  }

  // 3) Tokens held
  let tokenUsd = 0;
  for (const token of tokens || []) {
    const position = tokenPosition(token);
    if (!position) continue;
    tokenUsd += position.valueUsd;
    addChain(breakdown, token.chain, position.valueUsd);
    positions.push(position);
  }

  const totalUsd = defiProjects + defiApps + tokenUsd;

  // Cross-check against the historical curve (best-effort — a miss here isn't critical)
  let curveLast: number | null = null;
  try {
    const curve = await client.get<NetCurve>('/asset/total_net_curve', { user_addr: address, days: 1 });
    const list = curve?.usd_value_list || [];
    curveLast = list.length ? list[list.length - 1][1] : null;
  } catch {
    // the curve is optional; if the main three sources came back, we trust the sum
  }
  if (curveLast !== null && curveLast > 1 && totalUsd < curveLast * 0.9) {
    throw new DebankError(
      `sum $${totalUsd.toFixed(2)} is >10% below the curve's $${curveLast.toFixed(2)} — likely undercount, fall back to the browser`,
    );
  }

  // Clear out empty buckets and round
  const cleanBreakdown: Record<string, number> = {};
  for (const [key, usd] of Object.entries(breakdown)) {
    if (usd > 0.5) cleanBreakdown[key] = Math.round(usd * 100) / 100;
  }

  return {
    chain: 'EVM',
    address: rawAddress,
    totalUsd,
    positions,
    breakdown: Object.keys(cleanBreakdown).length ? cleanBreakdown : undefined,
  };
}
