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

export type SettingSpec = NumberSpec | ChoiceSpec;

export const REGISTRY = {
  'scan.evmSource': {
    kind: 'choice',
    group: 'source',
    label: 'EVM balances',
    about:
      'debank scrapes a page in a headless browser: ~6s, and an IP budget a few dozen wallets exhaust. zerion is an API: ~0.4s, no ban risk, needs ZERION_API_KEY on scanner-evm.',
    options: ['debank', 'zerion'],
    default: 'debank',
    env: 'SCAN_EVM_SOURCE',
    readBy: ['scanner-evm'],
    live: true,
  },

  'sync.activeIntervalMin': {
    kind: 'number',
    group: 'sync',
    label: 'Portfolios in use',
    about:
      'The real pacing knob: the queue only takes addresses that are due, so this — not scan speed — sets the load.',
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
    label: 'Portfolios nobody opens',
    about: 'Anonymous or signed-in makes no difference — only whether somebody has opened it.',
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
    label: 'Goes stale after',
    about: 'How long somebody can be away before their portfolio drops to the slow interval.',
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
} as const satisfies Record<string, SettingSpec>;

/** Every key the code may ask for. Derived, so it cannot drift from the declarations. */
export type SettingKey = keyof typeof REGISTRY;

type SpecOf<K extends SettingKey> = (typeof REGISTRY)[K];

/** The knobs that are a choice rather than a number */
export type ChoiceKey = {
  [K in SettingKey]: SpecOf<K> extends { kind: 'choice' } ? K : never;
}[SettingKey];

export type NumberKey = Exclude<SettingKey, ChoiceKey>;

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
export type SettingValues = { [K in SettingKey]: K extends ChoiceKey ? ChoiceOf<K> : number };

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
];
