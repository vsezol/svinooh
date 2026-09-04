export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "0x7A587E39…fC198" — an address shortened for display */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
