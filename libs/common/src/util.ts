export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Money, to the cent — the only rounding this codebase should be doing */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
