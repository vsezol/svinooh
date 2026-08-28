import type { HistoryRange, WalletDto } from '@svinooh/shared';
import type { AgentBlock, BarItem, TableCell } from './agent';
import { debtTotals, rewardsTotals } from './blocks';
import { fmtUsd0 } from './format';
import { EMPTY_SERIES, type Series } from './history';

/**
 * The agent, until there is one.
 *
 * This answers off the portfolio already loaded in the browser: no request, no
 * model, no server. It exists so the chat can be built and judged against real
 * numbers — the widgets have to hold a wallet with eleven pools and a wallet
 * with none, and mock data never fails the way real data does.
 *
 * It is deliberately the only thing that will be thrown away. Everything it
 * touches is `AgentBlock[]`, which is what the service will answer with, so
 * replacing this is replacing one function.
 */
export interface PortfolioContext {
  wallets: WalletDto[];
  totalUsd: number;
  /** The chart on the portfolio page, so an answer can show the same line */
  history: Series;
  period: HistoryRange;
  /** The change across the window, as the headline states it */
  change: { label: string; up: boolean } | null;
}

const STABLE = /^(USDC|USDT|DAI|USDE|FDUSD|TUSD|USDS|PYUSD|LUSD|GHO|CRVUSD|SUSD|USDD)$/i;
const POOL_KIND = /pool|liquidity|\blp\b/i;
const LENDING_KIND = /lend|borrow/i;

interface Position {
  wallet: string;
  protocol: string;
  kind: string;
  valueUsd: number;
  apy: number | null;
  healthRate: number | null;
  borrowApy: number | null;
  inRange: boolean | null;
  borrowed: number;
  legs: string[];
}

/** Every DeFi position across every wallet, flattened — nobody asks per wallet */
function positionsOf(wallets: WalletDto[]): Position[] {
  const out: Position[] = [];
  for (const wallet of wallets) {
    for (const p of wallet.positions) {
      if (p.category === 'token') continue;
      const tokens = p.tokens ?? [];
      out.push({
        wallet: wallet.chain,
        protocol: p.symbol,
        kind: p.name ?? 'DeFi',
        valueUsd: p.valueUsd,
        apy: p.apy ?? null,
        healthRate: p.healthRate ?? null,
        borrowApy: p.borrowApy ?? null,
        inRange: p.range == null ? null : p.range === 'in',
        borrowed: tokens.filter((t) => t.role === 'borrow').reduce((s, t) => s + Math.abs(t.valueUsd), 0),
        legs: tokens.filter((t) => t.role === 'supply').map((t) => t.symbol),
      });
    }
  }
  return out.sort((a, b) => b.valueUsd - a.valueUsd);
}

const pct = (part: number, whole: number): string => (whole ? `${((part / whole) * 100).toFixed(0)}%` : '—');

const nothing = (what: string): AgentBlock[] => [
  { kind: 'text', text: `Nothing to report — ${what}` },
];

function overview(ctx: PortfolioContext): AgentBlock[] {
  const positions = positionsOf(ctx.wallets);
  const defi = positions.reduce((s, p) => s + p.valueUsd, 0);
  const rewards = rewardsTotals(ctx.wallets);
  const counted = ctx.wallets.filter((w) => w.totalUsd !== null).length;
  const largest = positions[0];

  const blocks: AgentBlock[] = [
    {
      kind: 'text',
      text:
        `You track ${counted} ${counted === 1 ? 'wallet' : 'wallets'} worth ${fmtUsd0(ctx.totalUsd)}. ` +
        `DeFi holds ${fmtUsd0(defi)} of that across ${positions.length} ` +
        `${positions.length === 1 ? 'position' : 'positions'}, with ${fmtUsd0(rewards.total)} claimable right now.`,
    },
    {
      kind: 'stats',
      cards: [
        { label: 'TOTAL', value: fmtUsd0(ctx.totalUsd), note: ctx.change?.label, tone: ctx.change?.up ? 'up' : 'down' },
        { label: 'IN DEFI', value: fmtUsd0(defi), note: `${pct(defi, ctx.totalUsd)} of total` },
        { label: 'CLAIMABLE', value: fmtUsd0(rewards.total), note: 'fees + rewards' },
      ],
    },
  ];

  if (ctx.history.values.length >= 2) {
    blocks.push({
      kind: 'chart',
      title: `TOTAL BALANCE · ${ctx.period.toUpperCase()}`,
      series: ctx.history,
      period: ctx.period,
      sub: ctx.change?.label,
      subTone: ctx.change?.up ? 'up' : 'down',
    });
  }
  if (largest) {
    blocks.push({
      kind: 'note',
      text:
        `Largest single position: ${largest.protocol} at ${fmtUsd0(largest.valueUsd)} — ` +
        `${pct(largest.valueUsd, ctx.totalUsd)} of the portfolio` +
        (largest.inRange === false ? ', currently out of range.' : '.'),
    });
  }
  return blocks;
}

function pools(ctx: PortfolioContext): AgentBlock[] {
  const lp = positionsOf(ctx.wallets).filter((p) => POOL_KIND.test(p.kind) || p.inRange !== null);
  if (!lp.length) return nothing('you have no liquidity positions open.');

  const total = lp.reduce((s, p) => s + p.valueUsd, 0);
  const adrift = lp.filter((p) => p.inRange === false);
  const rows: TableCell[][] = lp.slice(0, 8).map((p) => [
    { text: `${p.protocol}${p.legs.length === 2 ? ` · ${p.legs.join('/')}` : ''}` },
    { text: fmtUsd0(p.valueUsd) },
    { text: p.apy === null ? '—' : `${(p.apy * 100).toFixed(1)}%` },
    {
      text: p.inRange === null ? '—' : p.inRange ? 'In range' : 'Out of range',
      tone: p.inRange === null ? 'muted' : p.inRange ? 'up' : 'down',
    },
  ]);

  const blocks: AgentBlock[] = [
    {
      kind: 'text',
      text:
        `You hold ${lp.length} liquidity ${lp.length === 1 ? 'position' : 'positions'} worth ${fmtUsd0(total)}` +
        ` — ${pct(total, ctx.totalUsd)} of the portfolio.` +
        (adrift.length
          ? ` ${adrift.length} of them ${adrift.length === 1 ? 'has' : 'have'} drifted out of range and stopped collecting fees.`
          : ' All of them are inside their range and earning.'),
    },
    { kind: 'table', columns: ['POOL', 'VALUE', 'APY', 'STATUS'], rows },
  ];
  if (adrift.length) {
    const idle = adrift.reduce((s, p) => s + p.valueUsd, 0);
    blocks.push({
      kind: 'note',
      text: `Rebalancing around the current price would put ${fmtUsd0(idle)} back to work.`,
    });
  }
  return blocks;
}

function health(ctx: PortfolioContext): AgentBlock[] {
  const loans = positionsOf(ctx.wallets).filter((p) => p.healthRate !== null);
  if (!loans.length) return nothing('none of your positions report a health factor.');

  // A health factor is read against 1.0, where the position is liquidated. Two
  // is comfortable and the bar says so; anything under 1.3 is most of the way
  // down its own bar, which is the point of drawing it at all.
  const items: BarItem[] = loans.slice(0, 6).map((p) => {
    const hf = p.healthRate as number;
    return {
      label: `${p.protocol}${p.kind && p.kind !== p.protocol ? ` · ${p.kind}` : ''}`,
      value: hf.toFixed(2),
      percent: Math.min(100, (hf / 3) * 100),
      tone: hf >= 2 ? 'up' : hf >= 1.3 ? 'accent' : 'down',
      sub: p.borrowed > 0 ? `Debt ${fmtUsd0(p.borrowed)}` : undefined,
    };
  });
  const worst = loans.reduce((a, b) => ((a.healthRate as number) <= (b.healthRate as number) ? a : b));

  return [
    {
      kind: 'text',
      text:
        `${loans.length} ${loans.length === 1 ? 'loan is' : 'loans are'} open. ` +
        `${worst.protocol} is the one to watch at ${(worst.healthRate as number).toFixed(2)} — ` +
        'the closer to 1.00, the closer to liquidation.',
    },
    { kind: 'bars', items },
    {
      kind: 'note',
      text: 'Alerts fire on the health factor you set per wallet in Notifications, and keep firing while it is under.',
    },
  ];
}

function stables(ctx: PortfolioContext): AgentBlock[] {
  let stable = 0;
  for (const wallet of ctx.wallets) {
    for (const p of wallet.positions) {
      if (p.category === 'token' && STABLE.test(p.symbol)) stable += p.valueUsd;
      for (const t of p.tokens ?? []) if (t.role !== 'borrow' && STABLE.test(t.symbol)) stable += t.valueUsd;
    }
  }
  const rest = Math.max(0, ctx.totalUsd - stable);
  // Stables sitting as a plain wallet holding are the idle ones; the same coin
  // supplied to a pool or a lending market is already working
  let idle = 0;
  for (const wallet of ctx.wallets) {
    for (const p of wallet.positions) {
      if (p.category === 'token' && STABLE.test(p.symbol)) idle += p.valueUsd;
    }
  }

  return [
    {
      kind: 'text',
      text:
        `Stablecoins are ${pct(stable, ctx.totalUsd)} of your portfolio (${fmtUsd0(stable)}), ` +
        `against ${fmtUsd0(rest)} in everything that moves.`,
    },
    {
      kind: 'stats',
      cards: [
        { label: 'STABLES', value: fmtUsd0(stable), note: `${pct(stable, ctx.totalUsd)} of total` },
        { label: 'VOLATILE', value: fmtUsd0(rest), note: `${pct(rest, ctx.totalUsd)} of total` },
        { label: 'IDLE STABLES', value: fmtUsd0(idle), note: 'sitting in wallets', tone: idle > 0 ? 'down' : 'muted' },
      ],
    },
  ];
}

function debt(ctx: PortfolioContext): AgentBlock[] {
  const owed = debtTotals(ctx.wallets).total;
  if (owed <= 0) return nothing('you have no open debt.');

  const loans = positionsOf(ctx.wallets).filter((p) => p.borrowed > 0);
  const rows: TableCell[][] = loans.slice(0, 8).map((p) => [
    { text: p.protocol },
    { text: fmtUsd0(p.borrowed) },
    { text: p.borrowApy === null ? '—' : `${(p.borrowApy * 100).toFixed(1)}%` },
    { text: p.healthRate === null ? '—' : p.healthRate.toFixed(2) },
  ]);

  return [
    {
      kind: 'text',
      text:
        `Total debt is ${fmtUsd0(owed)} against ${fmtUsd0(ctx.totalUsd)} in assets — ` +
        `a ${pct(owed, ctx.totalUsd)} loan-to-value ratio.`,
    },
    { kind: 'table', columns: ['VENUE', 'DEBT', 'APY', 'HF'], rows },
    {
      kind: 'note',
      text: 'A borrow rate crossing the threshold you set keeps telling you until it comes back under it.',
    },
  ];
}

function changed(ctx: PortfolioContext): AgentBlock[] {
  const blocks: AgentBlock[] = [
    {
      kind: 'text',
      text: ctx.change
        ? `Your portfolio is ${ctx.change.up ? 'up' : 'down'} ${ctx.change.label.replace(/^[+−-]/, '')} over the window on screen.`
        : 'There is not enough history yet to say what moved.',
    },
  ];
  if (ctx.history.values.length >= 2) {
    blocks.push({
      kind: 'chart',
      title: `TOTAL · ${ctx.period.toUpperCase()}`,
      series: ctx.history,
      period: ctx.period,
      sub: ctx.change?.label,
      subTone: ctx.change?.up ? 'up' : 'down',
    });
  }
  const byWallet = ctx.wallets
    .filter((w) => w.totalUsd !== null)
    .sort((a, b) => (b.totalUsd ?? 0) - (a.totalUsd ?? 0))
    .slice(0, 5);
  if (byWallet.length) {
    blocks.push({
      kind: 'table',
      columns: ['WALLET', 'VALUE', 'SHARE'],
      rows: byWallet.map((w) => [
        { text: w.label || `${w.chain} wallet` },
        { text: fmtUsd0(w.totalUsd ?? 0) },
        { text: pct(w.totalUsd ?? 0, ctx.totalUsd) },
      ]),
    });
  }
  return blocks;
}

const ROUTES: Array<{ about: RegExp; answer: (ctx: PortfolioContext) => AgentBlock[] }> = [
  { about: /pool|lp|liquid|range|yield/i, answer: pools },
  { about: /health|hf|liquidat|risk/i, answer: health },
  { about: /stable|usdc|usdt|exposure/i, answer: stables },
  { about: /debt|borrow|loan/i, answer: debt },
  { about: /chang|today|move|24h/i, answer: changed },
];

/** How long the stand-in takes to "think" — a real answer will not be instant either */
const LATENCY_MS = 2300;

export function localAnswerer(ctx: PortfolioContext) {
  return (question: string): Promise<AgentBlock[]> => {
    const route = ROUTES.find((r) => r.about.test(question))?.answer ?? overview;
    const blocks = route(ctx);
    return new Promise((resolve) => setTimeout(() => resolve(blocks), LATENCY_MS));
  };
}

export const EMPTY_CONTEXT: PortfolioContext = {
  wallets: [],
  totalUsd: 0,
  history: EMPTY_SERIES,
  period: '24h',
  change: null,
};
