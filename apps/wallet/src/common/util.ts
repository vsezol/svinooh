export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
