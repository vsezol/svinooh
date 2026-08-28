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
  type: 'int';
  unit?: string;
  default: number;
  min: number;
  max: number;
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
  presets: Array<{ key: string; label: string; about: string; values: Record<string, number> }>;
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

let overrides = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;

function clamp(spec: SettingSpec, raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  // A row outside its own declared bounds is a row written by something that
  // did not check; the value is refused rather than trusted, and the service
  // carries on with what it had
  return n < spec.min || n > spec.max ? null : Math.round(n);
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
      const next = new Map<string, number>();
      for (const row of rows) {
        const spec = SPECS.get(row.key);
        if (!spec) continue; // a key nobody declares any more
        const value = clamp(spec, row.value);
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
export function setting(key: string): number {
  const spec = SPECS.get(key);
  if (!spec) throw new Error(`No such setting: ${key}`);
  const override = overrides.get(key);
  if (override !== undefined) return override;
  const fromEnv = clamp(spec, process.env[spec.env]);
  return fromEnv ?? spec.default;
}

/** Only for reporting: what is set, versus what is merely defaulted */
export function settingsSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of REGISTRY.settings) out[spec.key] = setting(spec.key);
  return out;
}
