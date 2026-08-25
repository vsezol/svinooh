// Deterministic icon color derived from a string — as in the design
// (linear-gradient 135deg with hue from the seed).

function hashSeed(input: string): number {
  let seed = 0;
  for (let i = 0; i < input.length; i++) seed = (seed * 31 + input.charCodeAt(i)) >>> 0;
  return seed;
}

/** Gradient wallet/avatar tile (from address/handle) */
export function gradientFor(input: string): string {
  const hue = (hashSeed(input) * 137) % 360;
  return `linear-gradient(135deg, hsl(${hue},42%,38%) 50%, hsl(${(hue + 40) % 360},46%,26%) 50%)`;
}

// Known tickers use brand colors, everything else comes from the hash
const TOKEN_COLORS: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  WETH: '#627EEA',
  STETH: '#00A3FF',
  WSTETH: '#00A3FF',
  USDC: '#2775CA',
  USDT: '#26A17B',
  DAI: '#F5AC37',
  LINK: '#2A5ADA',
  UNI: '#FF007A',
  AAVE: '#B6509E',
  SOL: '#9945FF',
  JUP: '#10B2A5',
  JTO: '#5FB49C',
  MSOL: '#308D8A',
  TRX: '#EB0029',
  ARB: '#12AAFF',
  OP: '#FF0420',
  PENDLE: '#5DB7C4',
  GMX: '#2D42FC',
};

/** Position dot color by ticker */
export function tokenColor(symbol: string): string {
  const key = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (TOKEN_COLORS[key]) return TOKEN_COLORS[key];
  const hue = (hashSeed(key || symbol) * 89) % 360;
  return `hsl(${hue},48%,42%)`;
}

/** 1–2 letters for the position dot */
export function tokenInitials(symbol: string): string {
  const clean = symbol.replace(/^[^A-Za-z0-9]+/, '');
  return clean.slice(0, clean.length > 3 ? 2 : 1).toUpperCase() || '?';
}
