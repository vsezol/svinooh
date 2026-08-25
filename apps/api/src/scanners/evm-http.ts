import { debank, DebankError } from './debank-client';
import type { ScanPosition, ScanResult } from './types';

/**
 * EVM-баланс через веб-API debank.com (реверс-подпись, см. debank-client.ts).
 * Быстрый первичный путь; при любой осечке evm.ts откатывается на Chrome.
 *
 * Хедерный тотал DeBank = сумма ТРЁХ непересекающихся источников, ровно как
 * их складывает фронт DeBank:
 *   1) project_list — ончейн-DeFi (Aave, GMX, Pendle…)      user_addr
 *   2) app_list     — «приложения» (Hyperliquid и пр.)       user_id
 *   3) cache_balance_list — токены на балансе                user_addr
 * Пропусти app_list — тихо потеряешь Hyperliquid (у контрольного кошелька
 * это $3 512 из $27 485). Поэтому все три обязательны, а не «на выбор».
 *
 * Кросс-чек: total_net_curve (историческая кривая, приложения в неё не
 * входят). Если наша сумма МЕНЬШЕ последней точки кривой на >10% — значит
 * потеряли ончейн-стоимость, которую DeBank видит → это осечка, откат на
 * Chrome, а не запись заниженного числа в историю.
 */

interface DebankToken {
  chain?: string;
  symbol?: string;
  optimized_symbol?: string;
  display_symbol?: string;
  name?: string;
  amount?: number;
  price?: number;
  is_scam?: boolean;
}

interface PortfolioItem {
  name?: string;
  stats?: { net_usd_value?: number };
}

interface DebankProject {
  id?: string;
  name?: string;
  chain?: string;
  portfolio_item_list?: PortfolioItem[];
}

interface AppListResponse {
  apps?: DebankProject[];
  error_apps?: unknown[];
}

interface NetCurve {
  usd_value_list?: Array<[number, number]>;
}

const projectNetUsd = (project: DebankProject): number =>
  (project.portfolio_item_list || []).reduce((sum, item) => sum + (item.stats?.net_usd_value || 0), 0);

function addChain(breakdown: Record<string, number>, chain: string | undefined, usd: number): void {
  const key = chain || 'other';
  breakdown[key] = (breakdown[key] || 0) + usd;
}

export async function scanEvmHttp(rawAddress: string): Promise<ScanResult> {
  const address = rawAddress.toLowerCase(); // API DeBank отвергает checksummed-регистр
  const client = debank();

  // Последовательно, а не Promise.all: три одновременных подписанных запроса
  // ловят burst-лимит api.debank.com (429 стабильно на третьем, cache_balance),
  // особенно с датацентрового IP. Латентность фонового скана некритична.
  const projects = await client.get<DebankProject[]>('/portfolio/project_list', { user_addr: address });
  const appList = await client.get<AppListResponse>('/portfolio/app_list', { user_id: address });
  const tokens = await client.get<DebankToken[]>('/token/cache_balance_list', { user_addr: address });

  // DeBank не смог догрузить часть приложений → наша сумма неполна → откат
  if (appList?.error_apps?.length) {
    throw new DebankError(`app_list вернул ${appList.error_apps.length} error_apps — сумма неполна`);
  }

  const positions: ScanPosition[] = [];
  const breakdown: Record<string, number> = {};

  // 1) Ончейн-DeFi по протоколам — одна позиция на протокол
  let defiProjects = 0;
  for (const project of projects || []) {
    const usd = projectNetUsd(project);
    if (usd < 0.01) continue;
    defiProjects += usd;
    addChain(breakdown, project.chain, usd);
    const kinds = [...new Set((project.portfolio_item_list || []).map((i) => i.name).filter(Boolean))];
    positions.push({
      symbol: project.name || project.id || 'DeFi',
      name: kinds.length ? kinds.join(' · ') : (project.chain ?? null),
      valueUsd: usd,
      platform: project.name?.toLowerCase() ?? 'debank',
      category: 'defi',
    });
  }

  // 2) Приложения (Hyperliquid и пр.) — тоже одна позиция на приложение
  let defiApps = 0;
  for (const app of appList?.apps || []) {
    const usd = projectNetUsd(app);
    if (usd < 0.01) continue;
    defiApps += usd;
    addChain(breakdown, app.chain || app.id, usd);
    positions.push({
      symbol: app.name || app.id || 'App',
      name: app.id ?? null,
      valueUsd: usd,
      platform: app.id ?? 'debank',
      category: 'defi',
    });
  }

  // 3) Токены на балансе (scam исключаем — DeBank их в тотал не кладёт)
  let tokenUsd = 0;
  for (const token of tokens || []) {
    if (token.is_scam) continue;
    const amount = token.amount || 0;
    const price = token.price || 0;
    const usd = amount * price;
    if (usd < 0.01) continue;
    tokenUsd += usd;
    addChain(breakdown, token.chain, usd);
    positions.push({
      symbol: token.optimized_symbol || token.display_symbol || token.symbol || token.name || '???',
      amount,
      priceUsd: price,
      valueUsd: usd,
      platform: 'wallet',
      category: 'token',
    });
  }

  const totalUsd = defiProjects + defiApps + tokenUsd;

  // Кросс-чек против исторической кривой (best-effort — её осечка не критична)
  let curveLast: number | null = null;
  try {
    const curve = await client.get<NetCurve>('/asset/total_net_curve', { user_addr: address, days: 1 });
    const list = curve?.usd_value_list || [];
    curveLast = list.length ? list[list.length - 1][1] : null;
  } catch {
    // кривая не обязательна; если основные три источника пришли — доверяем сумме
  }
  if (curveLast !== null && curveLast > 1 && totalUsd < curveLast * 0.9) {
    throw new DebankError(
      `сумма $${totalUsd.toFixed(2)} ниже кривой $${curveLast.toFixed(2)} на >10% — вероятен недобор, откат на Chrome`,
    );
  }

  // Чистим нулевые бакеты и округляем
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
