/** Parse a positive integer env var, falling back when unset/invalid. */
export function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse a boolean env var (1/true/yes/on), falling back when unset. */
export function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Service name used as the metrics/logs `app` label and Loki stream label. */
export const serviceName = (): string => process.env.SERVICE_NAME || 'svinooh';
