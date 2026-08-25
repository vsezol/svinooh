import { randomBytes } from 'node:crypto';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short public portfolio identifier for the /p/:slug link */
export function randomSlug(length = 10): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return slug;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
