import { config } from './config';

export interface TgFrom {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: TgFrom;
  };
}

const API = (method: string) => `https://api.telegram.org/bot${config.botToken}/${method}`;

/** One long poll. Returns nothing on a timeout or a hiccup, which is not an error here. */
export async function getUpdates(offset: number): Promise<TgUpdate[]> {
  const res = await fetch(
    `${API('getUpdates')}?timeout=25&offset=${offset}&allowed_updates=["message"]`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`getUpdates ${res.status}`);
  const body = (await res.json()) as { result?: TgUpdate[] };
  return body.result ?? [];
}

/**
 * Sends a message, and says whether it landed.
 *
 * The answer matters for an alert: the queue holds the message until this
 * succeeds, so a Telegram outage delays a warning instead of losing it.
 */
export async function send(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void> {
  const res = await fetch(API('sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // Bold for the headings and monospace for the address, which is there to
      // be tapped and copied. Everything interpolated into a message is escaped
      // at the point it is built — see format.ts
      parse_mode: 'HTML',
      // The link is there to be read and pressed, not turned into a preview
      // card the size of the message
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`sendMessage ${res.status}`);
}
