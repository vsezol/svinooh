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
  // Ведущие '1' кодируют нулевые байты
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

const sha256 = (data: Uint8Array): Uint8Array => createHash('sha256').update(data).digest();

/**
 * TRON — base58check: 25 байт, префикс 0x41, последние 4 байта — контрольная
 * сумма double-SHA256. Именно контрольная сумма надёжно отличает TRON от
 * SOL-адреса, случайно начавшегося с 'T' (оба — base58 подходящей длины).
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
 * Порядок проверок важен:
 * - BTC bech32 и EVM оба бывают по 42 символа — различаются только префиксом;
 * - TRON-адрес (T + 33 base58) попадает в диапазон длины SOL (32–44 base58),
 *   поэтому TRON проверяется контрольной суммой, а SOL — последним.
 */
export function detectChain(raw: string): Chain | null {
  const address = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'EVM';
  if (/^(bc1[a-z0-9]{39,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address)) return 'BTC';
  if (isTronAddress(address)) return 'TRON';
  if (isSolAddress(address)) return 'SOL';
  return null;
}
