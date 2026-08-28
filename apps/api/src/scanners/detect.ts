import { createHash } from 'node:crypto';
import type { Chain } from '@svinooh/shared';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

export function base58Decode(input: string): Uint8Array | null {
  if (!input.length) return null;
  const bytes: number[] = [];
  for (const char of input) {
    let carry = BASE58_MAP.get(char);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's encode zero bytes
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

const sha256 = (data: Uint8Array): Uint8Array => createHash('sha256').update(data).digest();

/**
 * TRON — base58check: 25 bytes, 0x41 prefix, and the last 4 bytes are a
 * double-SHA256 checksum. The checksum is what reliably tells TRON apart from a
 * SOL address that happens to start with 'T' (both are base58 of a fitting length).
 */
export function isTronAddress(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;
  const expected = sha256(sha256(decoded.subarray(0, 21))).subarray(0, 4);
  const checksum = decoded.subarray(21);
  return checksum.every((byte, i) => byte === expected[i]);
}

export function isSolAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  const decoded = base58Decode(address);
  return decoded !== null && decoded.length === 32;
}

/**
 * Check order matters:
 * - BTC bech32 and EVM can both be 42 chars — they differ only by prefix;
 * - a TRON address (T + 33 base58) falls within SOL's length range (32–44 base58),
 *   so TRON is verified by checksum, and SOL is checked last.
 */
export function detectChain(raw: string): Chain | null {
  const address = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'EVM';
  if (/^(bc1[a-z0-9]{39,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address)) return 'BTC';
  if (isTronAddress(address)) return 'TRON';
  if (isSolAddress(address)) return 'SOL';
  return null;
}

/**
 * The one spelling of an address we store.
 *
 * EVM addresses are hex, and EIP-55 uses the CASE of the letters as a checksum —
 * `0xAbCd…` and `0xabcd…` are the same address, and the checksummed form is the
 * one wallets and explorers give people to copy. Everything downstream keys on
 * the exact string: the scan groups in listGroups, the rows a scan result is
 * applied to, AddressSnapshot's history, `@@unique([portfolioId, address])`. Two
 * spellings of one address is therefore two of everything — scanned twice on
 * every cycle, history split in half, and the same wallet addable twice to one
 * portfolio, where its balance is then counted twice in the total.
 *
 * Base58 chains are left as typed: there the case IS part of the address.
 *
 * Must be applied wherever an address is taken from a person, which is why it
 * sits next to detectChain — the chain is what says how to normalise.
 */
export function normalizeAddress(chain: Chain, raw: string): string {
  const address = raw.trim();
  return chain === 'EVM' ? address.toLowerCase() : address;
}
