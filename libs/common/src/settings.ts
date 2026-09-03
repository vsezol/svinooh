import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The tunables, and where their current values come from.
 *
 * A knob is declared once, in settings/registry.json, and read from there by
 * both stacks — these functions and the Python admin. The file is data rather
 * than code precisely because neither side should own it: adding a knob there
 * makes it appear in the admin with the right bounds and in the services with
 * the right default, and nothing has to be kept in step by hand.
 *
 * A value resolves database → environment → declared default. That order is the
 * whole design: the database is where an operator's decision lives and wins;
 * the environment still works for local development and for the moment the
 * database is unreachable; the default is what the service shipped with. So a
 * system with no Setting rows at all runs exactly as it always did.
 */
export interface SettingSpec {
  key: string;
  group: string;
  label: string;
  about: string;
  /** `int` is a number with bounds; `enum` is a choice from `options` */
  type: 'int' | 'enum';
  unit?: string;
  default: number | string;
  /** int only */
  min?: number;
  max?: number;
  /** enum only: every value this knob may take */
  options?: string[];
  /** The variable that still overrides the default when no row exists */
  env: string;
  readBy: string[];
  /** False — the reader has no database and picks the change up on its next deploy */
  live: boolean;
  note?: string;
}

export interface SettingsRegistry {
  version: number;
  groups: Array<{ key: string; label: string; about: string }>;
  settings: SettingSpec[];
  rules: Array<{ id: string; about: string; left: string; leftScale: number; op: '>='; right: string[] }>;
}

/**
 * Read from disk rather than imported, so the same file serves a CommonJS build
 * and a Python process without being compiled into either. `..` from dist and
 * from src both land on the package root, which is where it lives.
 */
export const REGISTRY: SettingsRegistry = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'settings', 'registry.json'), 'utf8'),
) as SettingsRegistry;

const SPECS = new Map(REGISTRY.settings.map((s) => [s.key, s]));

/** One row as the admin last wrote it */
export interface SettingRow {
  key: string;
  value: unknown;
}

/** How a service fetches the current rows. Whoever owns Prisma passes this in. */
export type SettingsReader = () => Promise<SettingRow[]>;

/**
 * How often a service re-reads the table.
 *
 * One small query per service per interval, which is nothing next to what these
 * services already do — and it is what turns a knob into something you change
 * rather than something you deploy. Fifteen seconds is under the shortest thing
 * any of them paces on, so a change lands before it could matter.
 */
export const SETTINGS_REFRESH_MS = 15_000;

let overrides = new Map<string, number | string>();
let timer: NodeJS.Timeout | null = null;

/**
 * A stored row, if it is a value this knob may actually take.
 *
 * A row outside its declared bounds, or naming a choice that no longer exists,
 * is a row written by something that did not check — it is refused rather than
 * trusted, and the service carries on with what it had. That matters most for
 * an enum: removing an option from the registry must not leave a service
 * running on a value nothing in the code still handles.
 */
function accept(spec: SettingSpec, raw: unknown): number | string | null {
  if (spec.type === 'enum') {
    const value = String(raw);
    return spec.options?.includes(value) ? value : null;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n < (spec.min ?? -Infinity) || n > (spec.max ?? Infinity) ? null : Math.round(n);
}

/**
 * Start following the table, and return the stop.
 *
 * The first read is awaited by the caller if it wants to; failing it is not
 * fatal — every key falls back to the environment and then to its default, so a
 * database that is briefly unreachable costs the operator's last change, not
 * the service.
 */
export function startSettings(read: SettingsReader, onError?: (error: Error) => void): () => void {
  const refresh = async () => {
    try {
      const rows = await read();
      const next = new Map<string, number | string>();
      for (const row of rows) {
        const spec = SPECS.get(row.key);
        if (!spec) continue; // a key nobody declares any more
        const value = accept(spec, row.value);
        if (value !== null) next.set(row.key, value);
      }
      overrides = next;
    } catch (error) {
      onError?.(error as Error);
    }
  };

  void refresh();
  timer = setInterval(() => void refresh(), SETTINGS_REFRESH_MS);
  // Never the reason a process stays alive
  timer.unref?.();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/**
 * What a knob is worth right now.
 *
 * Called at the point of use rather than read once into a config object — that
 * is what makes a change take effect without a restart, and it costs a map
 * lookup.
 */
/**
 * Every key the code is allowed to ask for.
 *
 * The registry is JSON so both stacks can read it, which means TypeScript
 * cannot derive this list from it — so it is written out here, and checked
 * against the file at startup. That check is not ceremony: renaming a key in
 * the JSON used to compile perfectly and then throw the first time a request
 * touched it, in production, because `setting` took a plain string. Now the
 * compiler catches the call sites and, if the two ever drift anyway, the
 * service refuses to start instead of failing later under load.
 */
const KEYS = [
  'scan.evmSource',
  'sync.activeIntervalMin',
  'sync.staleIntervalMin',
  'sync.staleAfterMin',
  'scan.reloadSec',
  'scan.prefetch',
  'scan.jobDelayMs',
  'scan.httpConcurrency',
  'scan.leaseMin',
  'scan.retryMin',
  'scan.httpTimeoutMs',
  'scan.evmTimeoutMs',
  'alerts.prefetch',
] as const;

export type SettingKey = (typeof KEYS)[number];

/**
 * The knobs that are a choice, and what they may be.
 *
 * Written out rather than derived, for the same reason KEYS is: the registry is
 * JSON. The check below covers the drift — an option the code handles that the
 * registry no longer offers, or the reverse.
 */
export interface Choice {
  'scan.evmSource': 'debank' | 'zerion';
}
export type ChoiceKey = keyof Choice;
export type NumberKey = Exclude<SettingKey, ChoiceKey>;

const CHOICES: Record<ChoiceKey, string[]> = { 'scan.evmSource': ['debank', 'zerion'] };
for (const [key, handled] of Object.entries(CHOICES)) {
  const declared = SPECS.get(key)?.options ?? [];
  if ([...declared].sort().join() !== [...handled].sort().join()) {
    throw new Error(
      `settings/registry.json declares ${key} as [${declared}] but the code handles [${handled}]`,
    );
  }
}

// A rule naming a knob nobody declares does nothing, quietly — which is how
// all of them stopped working once when their keys were renamed. It refuses to
// load instead.
for (const rule of REGISTRY.rules) {
  const unknown = [rule.left, ...rule.right].filter((key) => !SPECS.has(key));
  if (unknown.length) {
    throw new Error(`rule "${rule.id}" names settings that do not exist: ${unknown.join(', ')}`);
  }
}

const missing = KEYS.filter((key) => !SPECS.has(key));
if (missing.length) {
  throw new Error(
    `settings/registry.json is missing ${missing.join(', ')} — the code asks for keys the registry does not declare`,
  );
}

function current(key: string): number | string {
  const spec = SPECS.get(key);
  if (!spec) throw new Error(`No such setting: ${key}`);
  const override = overrides.get(key);
  if (override !== undefined) return override;
  return accept(spec, process.env[spec.env]) ?? spec.default;
}

export function setting(key: NumberKey): number {
  const value = current(key);
  if (typeof value !== 'number') throw new Error(`${key} is a choice, not a number — use option()`);
  return value;
}

/**
 * A knob whose value is one of a fixed set rather than a number.
 *
 * Separate from setting() rather than a union return, so a caller gets a
 * `'debank' | 'zerion'` it can switch on exhaustively instead of a string it
 * has to guess about — which is the whole reason the choice lives in the
 * registry and not in an environment variable somebody spells wrong once.
 */
export function option<K extends ChoiceKey>(key: K): Choice[K] {
  const value = current(key);
  if (typeof value !== 'string') throw new Error(`${key} is a number, not a choice — use setting()`);
  return value as Choice[K];
}

/**
 * Only for reporting: what is set, versus what is merely defaulted.
 *
 * Walks the registry rather than KEYS, so a knob declared for the admin but not
 * read anywhere in this codebase still shows up in the snapshot.
 */
export function settingsSnapshot(): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const spec of REGISTRY.settings) out[spec.key] = current(spec.key);
  return out;
}

/**
 * What every knob is worth, given the rows somebody has actually stored.
 *
 * The resolution order the services use — a stored row, then the environment,
 * then the declared default — applied to rows handed in rather than to the
 * polling cache, so the owner of the table sees its own writes immediately.
 */
export function effectiveSettings(rows: SettingRow[]): Record<string, number | string> {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const out: Record<string, number | string> = {};
  for (const spec of REGISTRY.settings) {
    const fromRow = stored.has(spec.key) ? accept(spec, stored.get(spec.key)) : null;
    out[spec.key] = fromRow ?? accept(spec, process.env[spec.env]) ?? spec.default;
  }
  return out;
}

/**
 * Every reason a proposed set of values cannot be saved, or an empty list.
 *
 * Two kinds of check, and the second is the one an environment variable could
 * never do: a knob against its own bounds, and knobs against each other. A
 * lease that expires before the scan it is leasing has finished is a valid
 * integer and a broken system.
 *
 * Ported from the Python admin this replaced, unchanged in behaviour — a rule
 * whose left side is a choice is skipped, because there is nothing to weigh.
 */
export function validateSettings(
  values: Record<string, number | string>,
  /**
   * What every knob is worth right now, from whoever owns the table.
   *
   * Passed in rather than read from the polling cache: the caller has just
   * written to that table and the cache is up to fifteen seconds behind, so
   * reading it here would weigh a rule against values that are already stale —
   * and, worse, show somebody their own change had not taken.
   */
  effective: Record<string, number | string>,
): string[] {
  const problems: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const spec = SPECS.get(key);
    if (!spec) {
      problems.push(`${key}: not a setting`);
      continue;
    }
    if (spec.type === 'enum') {
      if (!spec.options?.includes(String(value))) {
        problems.push(`${spec.label}: "${value}" is not one of ${spec.options?.join(', ')}`);
      }
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      problems.push(`${spec.label}: "${value}" is not a number`);
    } else if (n < (spec.min ?? -Infinity) || n > (spec.max ?? Infinity)) {
      const unit = spec.unit ? ` ${spec.unit}` : '';
      problems.push(`${spec.label}: ${n}${unit} is outside ${spec.min}–${spec.max}${unit}`);
    }
  }
  if (problems.length) return problems;

  // Whatever is not being changed keeps the value it has, so a rule weighs the
  // system as it would actually be rather than as the form was filled in
  const proposed = (key: string): number => {
    const raw = values[key] ?? effective[key];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  for (const rule of REGISTRY.rules) {
    const left = SPECS.get(rule.left);
    if (!left || left.type === 'enum') continue;
    const lhs = proposed(rule.left) * rule.leftScale;
    const rhs = rule.right.reduce((sum, key) => sum + (SPECS.has(key) ? proposed(key) : 0), 0);
    if (lhs < rhs) problems.push(rule.about);
  }
  return problems;
}
