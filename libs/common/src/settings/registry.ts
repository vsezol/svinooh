/**
 * Every tunable this system has, declared once.
 *
 * This file says what a knob IS: its bounds, its default, who reads it, what it
 * means. It does not say what it is worth — that is a row in the `Setting`
 * table, written from the admin panel, and it wins over everything here. A
 * system with no rows runs on these defaults, which is what makes them
 * defaults.
 *
 * It used to be JSON, because a Python admin read the same file. That admin is
 * gone, and JSON was costing more than it bought: the key list, the choice
 * lists and the rules all had to be mirrored by hand in TypeScript, with
 * startup checks to catch the mirrors drifting. Declared here instead, every
 * one of those is derived — see the types below. A knob added to this object is
 * a knob the compiler knows about everywhere, and a rule naming a knob that
 * does not exist does not compile.
 */

interface Declared {
  /** Which card in the panel. `source` and `sync` are named there; the rest is machinery */
  group: string;
  label: string;
  /** One sentence, shown in the panel's tooltip */
  about: string;
  /** The variable that still overrides the default when no row exists */
  env: string;
  readBy: readonly string[];
  /** False — the reader has no database and picks the change up on its next deploy */
  live: boolean;
  /** Anything a person changing this needs that does not fit in one sentence */
  note?: string;
}

interface NumberSpec extends Declared {
  kind: 'number';
  unit?: string;
  default: number;
  min: number;
  max: number;
}

interface ChoiceSpec extends Declared {
  kind: 'choice';
  options: readonly string[];
  default: string;
}

/**
 * A value with no small set to pick from — a model identifier, for instance.
 *
 * Deliberately rare: a choice is safer, because a list cannot be mistyped. It
 * earns its place only where the possibilities are somebody else's to define
 * and change, which is exactly true of the models an aggregator offers.
 */
interface TextSpec extends Declared {
  kind: 'text';
  default: string;
  maxLength: number;
  /** Shown in the field when it is empty — a real example, not a description */
  placeholder?: string;
}

export type SettingSpec = NumberSpec | ChoiceSpec | TextSpec;

export const REGISTRY = {
  'scan.evmSource': {
    kind: 'choice',
    group: 'source',
    label: 'EVM balances',
    about:
      'browser renders debank.com headlessly: 6-19s, and an IP budget a few dozen wallets exhaust. api is Zerion plus a provider per venue it does not cover: under a second, no ban risk, needs ZERION_API_KEY on scanner-evm.',
    options: ['browser', 'api'],
    default: 'browser',
    env: 'SCAN_EVM_SOURCE',
    readBy: ['scanner-evm'],
    live: true,
  },

  'sync.activeIntervalMin': {
    kind: 'number',
    group: 'sync',
    label: 'Popular wallet',
    about:
      'One somebody still opens: at least one portfolio holding it has been visited recently, however many portfolios hold it. The real pacing knob — the queue only takes addresses that are due, so this, not scan speed, sets the load.',
    unit: 'min',
    default: 5,
    min: 1,
    max: 240,
    env: 'SYNC_ACTIVE_INTERVAL_MIN',
    readBy: ['wallet', 'api', 'auth'],
    live: true,
    note: 'Read by three services. The api marks a wallet stale against this and reports it to the browser, so this being one value in one place is the point.',
  },
  'sync.staleIntervalMin': {
    kind: 'number',
    group: 'sync',
    label: 'Stale wallet',
    about:
      'One nobody opens any more: every portfolio holding it has gone quiet. Anonymous or signed-in makes no difference — only whether somebody visited.',
    unit: 'min',
    default: 30,
    min: 1,
    max: 1440,
    env: 'SYNC_STALE_INTERVAL_MIN',
    readBy: ['wallet'],
    live: true,
  },
  'sync.staleAfterMin': {
    kind: 'number',
    group: 'sync',
    label: 'Wallet goes stale after',
    about:
      'How long a wallet stays popular after the last visit to any portfolio holding it. This is the line the two intervals above are on either side of.',
    unit: 'min',
    default: 1440,
    min: 1,
    max: 10080,
    env: 'SYNC_STALE_AFTER_MIN',
    readBy: ['wallet'],
    live: true,
  },

  'scan.reloadSec': {
    kind: 'number',
    group: 'queue',
    label: 'Queue top-up',
    about:
      'How often the producer looks for addresses that have come due. Cheap: an address that is not due is not enqueued.',
    unit: 'sec',
    default: 15,
    min: 5,
    max: 600,
    env: 'SCAN_RELOAD_SEC',
    readBy: ['wallet'],
    live: true,
  },
  'scan.prefetch': {
    kind: 'number',
    group: 'queue',
    label: 'Addresses per scanner',
    about:
      'How many at once. Raising it multiplies the request rate against the same upstream sources, which is what earns a 429.',
    default: 1,
    min: 1,
    max: 16,
    env: 'SCAN_PREFETCH',
    readBy: ['wallet'],
    live: true,
  },
  'scan.jobDelayMs': {
    kind: 'number',
    group: 'queue',
    label: 'Pause after each scan',
    about: 'The pacing knob against DeBank. The scanner holds its queue slot for the whole pause.',
    unit: 'ms',
    default: 1500,
    min: 0,
    max: 60000,
    env: 'SCAN_JOB_DELAY_MS',
    readBy: ['scanner-evm', 'wallet'],
    live: false,
    note: "The scanner service has no database and cannot pick this up live; it applies there on the next deploy. The wallet service's own in-process loop reads it live.",
  },
  'scan.httpConcurrency': {
    kind: 'number',
    group: 'queue',
    label: 'Parallel requests per scan',
    about: 'Inside one BTC, SOL or TRON scan. Separate from how many scans run at all.',
    default: 4,
    min: 1,
    max: 32,
    env: 'SCAN_HTTP_CONCURRENCY',
    readBy: ['wallet'],
    live: true,
  },
  'alerts.prefetch': {
    kind: 'number',
    group: 'queue',
    label: 'Alert events at once',
    about:
      'How many wallet-state events the collector works through in parallel. The work is a couple of queries.',
    default: 4,
    min: 1,
    max: 32,
    env: 'ALERTS_PREFETCH',
    readBy: ['monitor-alerts'],
    live: false,
    note: "A consumer's prefetch is fixed when it subscribes, so this one takes effect on the next deploy of monitor-alerts.",
  },

  'scan.leaseMin': {
    kind: 'number',
    group: 'limits',
    label: 'Scan lease',
    about: 'How long an address is believed to be in flight before it counts as free again.',
    unit: 'min',
    default: 10,
    min: 1,
    max: 120,
    env: 'SCAN_LEASE_MIN',
    readBy: ['wallet'],
    live: true,
  },
  'scan.retryMin': {
    kind: 'number',
    group: 'limits',
    label: 'Retry after a failure',
    about: "Keeps somebody else's outage from becoming our own rate limit.",
    unit: 'min',
    default: 5,
    min: 1,
    max: 120,
    env: 'SCAN_RETRY_MIN',
    readBy: ['wallet'],
    live: true,
  },
  'scan.httpTimeoutMs': {
    kind: 'number',
    group: 'limits',
    label: 'HTTP scan timeout',
    about: 'Per request in the BTC, SOL and TRON scanners.',
    unit: 'ms',
    default: 15000,
    min: 1000,
    max: 120000,
    env: 'HTTP_TIMEOUT_MS',
    readBy: ['wallet'],
    live: true,
  },
  'scan.evmTimeoutMs': {
    kind: 'number',
    group: 'limits',
    label: 'EVM scan timeout',
    about: 'A browser scan is slow by nature: a page load with chains resolving one by one.',
    unit: 'ms',
    default: 150000,
    min: 10000,
    max: 600000,
    env: 'EVM_TIMEOUT_MS',
    readBy: ['scanner-evm'],
    live: false,
  },

  'billing.enforce': {
    kind: 'choice',
    group: 'billing',
    label: 'Free-plan limits',
    about:
      'off — everything stays free and only the counters run, so flipping this on later starts from honest numbers. Keep it off until the web has a paywall to show instead of a bare 402.',
    options: ['off', 'on'],
    default: 'off',
    env: 'BILLING_ENFORCE',
    readBy: ['api', 'monitor-alerts'],
    live: true,
  },
  'billing.proPriceUsd': {
    kind: 'number',
    group: 'billing',
    label: 'Pro price',
    about: 'What a month of Svinooh.Pro costs. Copied onto each payment at checkout, so changing it never rewrites history.',
    unit: 'usd',
    default: 5,
    min: 1,
    max: 1000,
    env: 'BILLING_PRO_PRICE_USD',
    readBy: ['api', 'monitor-alerts'],
    live: true,
  },
  'billing.proWasPriceUsd': {
    kind: 'number',
    group: 'billing',
    label: 'Pro price before discount',
    about: 'The crossed-out anchor the live price is compared against. The discount percent everywhere is derived from these two, never typed by hand.',
    unit: 'usd',
    default: 10,
    min: 1,
    max: 1000,
    env: 'BILLING_PRO_WAS_PRICE_USD',
    readBy: ['api', 'monitor-alerts'],
    live: true,
  },
  'billing.firstMonthUsd': {
    kind: 'number',
    group: 'billing',
    label: 'First month price',
    about: 'The hook: what the first month ever costs. Eligibility is "has never had a finished payment", so it cannot be re-earned by letting Pro lapse.',
    unit: 'usd',
    default: 2,
    min: 1,
    max: 1000,
    env: 'BILLING_FIRST_MONTH_USD',
    readBy: ['api', 'monitor-alerts'],
    live: true,
  },
  'billing.payCoin': {
    kind: 'choice',
    group: 'billing',
    label: 'Checkout coin',
    about:
      "What the invoice is locked to. 'page' — the payer picks a coin on the gateway's page, from the list curated in the NOWPayments dashboard. A locked coin is the whole invoice: no switching there.",
    options: [
      'page',
      'usdttrc20',
      'usdtton',
      'usdtbsc',
      'usdtsol',
      'usdterc20',
      'usdcsol',
      'usdcbsc',
      'usdcbase',
    ],
    default: 'page',
    env: 'BILLING_PAY_COIN',
    readBy: ['api'],
    live: true,
    note: 'A lock is checked against the coin\'s live network minimum at checkout and quietly falls back to the open page when it does not fit the price — USDT-TRC20 sits above 11 USD as of 2026-09, so at a 5-10 USD price it will fall back until the price clears it.',
  },
  'billing.freeAlerts': {
    kind: 'number',
    group: 'billing',
    label: 'Free alerts, lifetime',
    about: 'The trial: how many alert messages a free account is ever delivered. Counted per message, not per position, and never refilled.',
    default: 10,
    min: 0,
    max: 10000,
    env: 'BILLING_FREE_ALERTS',
    readBy: ['monitor-alerts', 'api'],
    live: true,
  },
  'billing.freePortfolios': {
    kind: 'number',
    group: 'billing',
    label: 'Free portfolios',
    about: 'How many portfolios a free account may own, counting claimed ones. Sign-in still hands out the first one; this gates the next.',
    default: 1,
    min: 1,
    max: 100,
    env: 'BILLING_FREE_PORTFOLIOS',
    readBy: ['api'],
    live: true,
  },
  'billing.freeWalletsPerPortfolio': {
    kind: 'number',
    group: 'billing',
    label: 'Free wallets per portfolio',
    about: 'The wallet cap on any portfolio a Pro member is not adding to — owned and anonymous alike, since every wallet is rescanned forever.',
    default: 5,
    min: 1,
    max: 100,
    env: 'BILLING_FREE_WALLETS_PER_PORTFOLIO',
    readBy: ['api'],
    live: true,
  },
  'billing.freeHistoryDays': {
    kind: 'number',
    group: 'billing',
    label: 'Free history window',
    about: 'How far back the charts reach on the free plan. Ranges wider than this answer 402 with the offer; narrower ones stop scrolling past it.',
    unit: 'days',
    default: 7,
    min: 1,
    max: 365,
    env: 'BILLING_FREE_HISTORY_DAYS',
    readBy: ['api'],
    live: true,
  },
  'billing.freeAiPerDay': {
    kind: 'number',
    group: 'billing',
    label: 'Free AI requests per day',
    about: 'The agent quota for free accounts, per UTC day. The agent is not shipped yet; the meter and the gate are ready for it.',
    default: 1,
    min: 0,
    max: 1000,
    env: 'BILLING_FREE_AI_PER_DAY',
    readBy: ['api'],
    live: true,
  },
  'agent.model': {
    kind: 'text',
    group: 'agent',
    label: 'Answering model',
    about:
      'The model whose words the user reads. "<provider>:<model>" — through an aggregator the provider is openai, because that is the wire it speaks for every vendor: openai:deepseek/deepseek-v4-flash.',
    default: 'openai:deepseek/deepseek-v4-flash',
    maxLength: 120,
    placeholder: 'openai:deepseek/deepseek-v4-flash',
    env: 'AGENT_MODEL',
    readBy: ['agent'],
    live: true,
    note: 'Changing this changes what every answer costs and how long it takes. The agent re-reads within a minute — no deploy, and no restart.',
  },
  'agent.reasoningEffort': {
    kind: 'choice',
    group: 'agent',
    label: 'Answering model thinks',
    about:
      'How much the answering model may think before it writes. Thinking costs seconds a person spends watching a cursor, and buys care on a hard question.',
    options: ['none', 'minimal', 'low', 'medium', 'high'],
    default: 'minimal',
    env: 'AGENT_REASONING_EFFORT',
    readBy: ['agent'],
    live: true,
  },
  'agent.maxTokens': {
    kind: 'number',
    group: 'agent',
    label: 'Answer length cap',
    about: 'The longest answer the model may write, in tokens. A chat answer that runs past a screen is rarely a better answer.',
    unit: 'tokens',
    default: 1024,
    min: 128,
    max: 8192,
    env: 'AGENT_MAX_TOKENS',
    readBy: ['agent'],
    live: true,
  },
  'agent.routerModel': {
    kind: 'text',
    group: 'agent',
    label: 'Labelling model',
    about:
      'The model that decides what a question is about, and whether a reply means yes. It writes a dozen tokens in front of every answer, so it should be the cheapest one that labels reliably. Empty — the answering model does it too.',
    default: 'openai:qwen/qwen3-30b-a3b-instruct-2507',
    maxLength: 120,
    placeholder: 'openai:qwen/qwen3-30b-a3b-instruct-2507',
    env: 'AGENT_ROUTER_MODEL',
    readBy: ['agent'],
    live: true,
    note: 'It sits on the critical path: a model that thinks before labelling makes every answer wait for it.',
  },
  'agent.routerReasoningEffort': {
    kind: 'choice',
    group: 'agent',
    label: 'Labelling model thinks',
    about:
      'Picking one word out of two needs no deliberation. Avoid "none": some endpoints refuse to think less than they want to and answer 400, and while the agent recovers from that by itself, it should not have to.',
    options: ['none', 'minimal', 'low', 'medium', 'high'],
    default: 'low',
    env: 'AGENT_ROUTER_REASONING_EFFORT',
    readBy: ['agent'],
    live: true,
  },
  'agent.toolHops': {
    kind: 'number',
    group: 'agent',
    label: 'Tool rounds per answer',
    about:
      'How many times the model may look something up before it has to answer with what it has. Most answers need none; two is a lookup and a correction. Each round is another paid call and another wait.',
    unit: 'rounds',
    default: 3,
    min: 0,
    max: 6,
    env: 'AGENT_TOOL_HOPS',
    readBy: ['agent'],
    live: true,
  },
  'agent.contextMaxPositions': {
    kind: 'number',
    group: 'agent',
    label: 'Positions shown to the model',
    about:
      'How many positions per wallet the model is shown, largest first. The rest are summarised with their total and can still be looked up by name, so this trades tokens on every turn against detail the model has at hand.',
    unit: 'per wallet',
    default: 12,
    min: 3,
    max: 60,
    env: 'AGENT_CONTEXT_MAX_POSITIONS',
    readBy: ['agent'],
    live: true,
  },
  'agent.providerSort': {
    kind: 'choice',
    group: 'agent',
    label: 'Prefer providers by',
    about:
      'One model identifier is served by several providers behind an aggregator, and they differ. Throughput picks the fastest to answer; price the cheapest; latency the quickest to start.',
    options: ['throughput', 'price', 'latency'],
    default: 'throughput',
    env: 'AGENT_PROVIDER_SORT',
    readBy: ['agent'],
    live: true,
  },
} as const satisfies Record<string, SettingSpec>;

/** Every key the code may ask for. Derived, so it cannot drift from the declarations. */
export type SettingKey = keyof typeof REGISTRY;

type SpecOf<K extends SettingKey> = (typeof REGISTRY)[K];

/** The knobs that are a choice rather than a number */
export type ChoiceKey = {
  [K in SettingKey]: SpecOf<K> extends { kind: 'choice' } ? K : never;
}[SettingKey];

/** The knobs that are free text — a model identifier and its like */
export type TextKey = {
  [K in SettingKey]: SpecOf<K> extends { kind: 'text' } ? K : never;
}[SettingKey];

export type NumberKey = Exclude<SettingKey, ChoiceKey | TextKey>;

/**
 * What one choice may be — `'debank' | 'zerion'`, read off the declaration.
 *
 * This is why `option('scan.evmSource')` can be switched on exhaustively:
 * adding an option above widens this type, and every switch that does not
 * handle it stops compiling.
 */
export type ChoiceOf<K extends ChoiceKey> =
  SpecOf<K> extends { options: readonly (infer O)[] } ? O : never;

/** What every knob is worth: a number, or one of its declared options */
export type SettingValues = {
  [K in SettingKey]: K extends ChoiceKey ? ChoiceOf<K> : K extends TextKey ? string : number;
};

/** What to change. Keys left out keep the value they have. */
export type SettingsPatch = Partial<SettingValues>;

export const KEYS = Object.keys(REGISTRY) as SettingKey[];

/**
 * A constraint between knobs — the kind of thing bounds cannot express.
 *
 * `left × scale` must be at least the sum of `atLeast`. Both sides name keys,
 * and the compiler checks that they exist: a rule pointing at a knob that was
 * renamed used to be skipped in silence, which is how every rule here stopped
 * working once.
 */
export interface SettingRule {
  id: string;
  /** Said to whoever tried to save, so it explains rather than reports */
  about: string;
  left: NumberKey;
  /** Puts both sides in the same unit — minutes to ms, say */
  scale: number;
  atLeast: readonly NumberKey[];
}

export const RULES: readonly SettingRule[] = [
  {
    id: 'lease-outlasts-scan',
    about:
      'The scan lease must outlast the slowest scan it covers, or an address is dispatched a second time while the first is still running.',
    left: 'scan.leaseMin',
    scale: 60_000,
    atLeast: ['scan.evmTimeoutMs', 'scan.jobDelayMs'],
  },
  {
    id: 'stale-not-faster-than-active',
    about:
      'The interval for portfolios nobody opens cannot be shorter than the one for portfolios in use — that would scan the forgotten ones more often than the watched ones.',
    left: 'sync.staleIntervalMin',
    scale: 1,
    atLeast: ['sync.activeIntervalMin'],
  },
  {
    id: 'discount-is-real',
    about:
      'The crossed-out price must not be under the live one, or every "instead of" on the marketing page reads as a markup.',
    left: 'billing.proWasPriceUsd',
    scale: 1,
    atLeast: ['billing.proPriceUsd'],
  },
  {
    id: 'first-month-is-the-hook',
    about:
      'The first-month price is the pitch and cannot exceed a regular month, or the welcome offer charges extra for arriving.',
    left: 'billing.proPriceUsd',
    scale: 1,
    atLeast: ['billing.firstMonthUsd'],
  },
];
