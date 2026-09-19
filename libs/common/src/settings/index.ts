import {
  KEYS,
  NO_THINKING,
  REGISTRY,
  ROLE_PAIRS,
  type ChoiceKey,
  type ChoiceOf,
  type NumberKey,
  type TextKey,
  type SettingKey,
  type SettingSpec,
  type SettingValues,
} from './registry';

export * from './registry';
export * from './patch';

/**
 * What a knob is worth right now, and how it got that way.
 *
 * A value resolves database → environment → declared default. That order is the
 * whole design: the database is where an operator's decision lives and wins;
 * the environment still works for local development and for the moment the
 * database is unreachable; the default is what the service shipped with. So a
 * system with no `Setting` rows at all runs exactly as it always did.
 */

export type SettingValue = number | string;

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

/**
 * A raw value, if it is one this knob may actually take, else null.
 *
 * A stored row outside its bounds, or naming a choice that no longer exists, is
 * a row written by something that did not check: it is refused rather than
 * trusted. That matters most for a choice — removing an option must not leave a
 * service running on a value nothing in the code still handles.
 */
function accept(spec: SettingSpec, raw: unknown): SettingValue | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (spec.kind === 'choice') {
    const value = String(raw);
    return spec.options.includes(value) ? value : null;
  }
  if (spec.kind === 'text') {
    const value = String(raw).trim();
    return value && value.length <= spec.maxLength ? value : null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n < spec.min || n > spec.max ? null : Math.round(n);
}

/** database → environment → default, for one knob */
function resolve(key: SettingKey, stored: unknown): SettingValue {
  const spec: SettingSpec = REGISTRY[key];
  return accept(spec, stored) ?? accept(spec, process.env[spec.env]) ?? spec.default;
}

/** Every knob at once, given whatever rows the caller has in hand */
export function effectiveSettings(rows: readonly SettingRow[]): SettingValues {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const out = {} as SettingValues;
  for (const key of KEYS) {
    (out as Record<SettingKey, SettingValue>)[key] = resolve(key, stored.get(key));
  }
  return out;
}

/** What every knob is worth right now, refreshed from the table on a timer */
let inForce: SettingValues = effectiveSettings([]);
let timer: NodeJS.Timeout | null = null;

/**
 * Start following the table, and return the stop.
 *
 * Failing a read is not fatal: every key falls back to the environment and then
 * to its default, so a database that is briefly unreachable costs the
 * operator's last change, not the service.
 */
export function startSettings(read: SettingsReader, onError?: (error: Error) => void): () => void {
  const refresh = async () => {
    try {
      inForce = effectiveSettings(await read());
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
 * A number knob. Read at the point of use rather than into a config object —
 * that is what makes a change take effect without a restart.
 */
export const setting = (key: NumberKey): number => inForce[key];

/**
 * A choice knob, typed as its own options so a caller can switch on it
 * exhaustively rather than guess about a string.
 */
export const option = <K extends ChoiceKey>(key: K): ChoiceOf<K> =>
  // SettingValues[K] IS ChoiceOf<K> by definition, but a conditional type does
  // not reduce while K is still generic, so the compiler needs telling
  inForce[key] as ChoiceOf<K>;

/**
 * A free-text knob — a model identifier and its like.
 *
 * Returns the empty string when the value is meant to be absent, which is a
 * value in itself: the labelling model falls back to the answering one.
 */
export const text = (key: TextKey): string => String(inForce[key] ?? '');

/**
 * A knob and what it is worth, as the panel renders it.
 *
 * Written out rather than derived from SettingSpec with Omit: SettingSpec is a
 * union, and Omit over a union keeps only the keys both halves share — which
 * quietly dropped min, max and unit. This is also the wire contract, mirrored
 * in @svinooh/shared for the browser, so being explicit is the honest shape.
 */
export interface SettingView {
  key: SettingKey;
  group: string;
  label: string;
  about: string;
  kind: 'number' | 'choice' | 'text';
  value: SettingValue;
  default: SettingValue;
  /** number knobs */
  unit?: string;
  min?: number;
  max?: number;
  /** choice knobs */
  options?: string[];
  /** text knobs */
  maxLength?: number;
  placeholder?: string;
  live: boolean;
  note?: string;
  readBy: string[];
  role?: { effort: SettingKey; noThinking: string };
}

export const settingsView = (values: SettingValues): SettingView[] =>
  KEYS.map((key) => {
    const spec: SettingSpec = REGISTRY[key];
    const common = {
      key,
      group: spec.group,
      label: spec.label,
      about: spec.about,
      kind: spec.kind,
      value: values[key],
      default: spec.default,
      live: spec.live,
      note: spec.note,
      readBy: [...spec.readBy],
    };
    if (spec.kind === 'choice') return { ...common, options: [...spec.options] };
    if (spec.kind === 'text') {
      const pair = ROLE_PAIRS.find((role) => role.model === key);
      return {
        ...common,
        maxLength: spec.maxLength,
        placeholder: spec.placeholder,
        ...(pair ? { role: { effort: pair.effort, noThinking: NO_THINKING } } : {}),
      };
    }
    return { ...common, unit: spec.unit, min: spec.min, max: spec.max };
  });
