import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramAuthPayload } from '@svinooh/shared';

/**
 * Проверка подписи Telegram Login Widget:
 * data_check_string — все поля кроме hash, отсортированные по ключу,
 * склеенные через \n; ключ HMAC — SHA256(bot_token).
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * Возвращает null, если всё хорошо, иначе — причину отказа.
 */
export function verifyTelegramLogin(payload: TelegramAuthPayload, botToken: string): string | null {
  const { hash, ...rest } = payload as unknown as Record<string, unknown> & { hash?: unknown };
  if (typeof hash !== 'string' || !hash) return 'missing hash field';

  const checkString = Object.keys(rest)
    .filter((key) => rest[key] !== undefined && rest[key] !== null)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'signature mismatch';

  const ageSeconds = Date.now() / 1000 - Number(payload.auth_date);
  if (!Number.isFinite(ageSeconds) || ageSeconds > 86_400 || ageSeconds < -300) {
    return 'auth_date is stale';
  }
  return null;
}
