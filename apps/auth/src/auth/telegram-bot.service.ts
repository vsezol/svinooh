import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { sleep } from '../common/util';

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface LoginToken {
  status: 'pending' | 'authenticated';
  user?: TgUser;
  createdAt: number;
}

const TOKEN_TTL_MS = 5 * 60_000;

/**
 * Bot sign-in via deep link: the site creates a token and opens
 * t.me/<bot>?start=<token> → the Telegram app opens for the user on the
 * bot, they tap Start → Telegram sends the bot "/start <token>". We read
 * updates via getUpdates long-polling (one consumer per bot; the service runs
 * as a single replica). The update comes from Telegram under our bot token, so
 * `from` is already authentic — HMAC, as in the web widget, isn't needed here.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly tokens = new Map<string, LoginToken>();
  private running = false;
  private offset = 0;

  onApplicationBootstrap() {
    if (!config.botToken) {
      this.logger.log('TELEGRAM_BOT_TOKEN not set — bot sign-in disabled');
      return;
    }
    this.running = true;
    void this.pollLoop();
    this.logger.log('Bot long-polling started');
  }

  onModuleDestroy() {
    this.running = false;
  }

  /** Create a pending token for a new login */
  create(token: string): void {
    this.cleanup();
    this.tokens.set(token, { status: 'pending', createdAt: Date.now() });
  }

  /** Current token state (null — missing or expired) */
  get(token: string): LoginToken | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  /** Take the authenticated token (one-time use) */
  consume(token: string): LoginToken | null {
    const entry = this.get(token);
    if (entry) this.tokens.delete(token);
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (now - entry.createdAt > TOKEN_TTL_MS) this.tokens.delete(token);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const url = `https://api.telegram.org/bot${config.botToken}/getUpdates?timeout=25&offset=${this.offset}&allowed_updates=["message"]`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          await sleep(2000);
          continue;
        }
        const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
        for (const update of body.result ?? []) {
          this.offset = update.update_id + 1;
          this.handleUpdate(update);
        }
      } catch {
        // long-poll timeout or network failure — just keep going
        await sleep(1000);
      }
    }
  }

  private handleUpdate(update: TgUpdate): void {
    const msg = update.message;
    const text = msg?.text ?? '';
    if (!msg?.from || !text.startsWith('/start')) return;
    const payload = text.slice('/start'.length).trim();
    if (!payload) return;

    const entry = this.tokens.get(payload);
    if (!entry || Date.now() - entry.createdAt > TOKEN_TTL_MS) return;

    entry.status = 'authenticated';
    entry.user = {
      id: msg.from.id,
      first_name: msg.from.first_name,
      last_name: msg.from.last_name,
      username: msg.from.username,
    };
    this.logger.log(`Login confirmed by bot: @${msg.from.username ?? msg.from.id}`);
    // The return button carries the same token: when opened via ?tg_login=<token> the site
    // completes the login itself — even in a new tab or after the page reloaded.
    void this.reply(msg.chat.id, "✅ You're signed in! Tap below to return to svinooh.", {
      inline_keyboard: [[{ text: 'Return to svinooh →', url: `${config.webUrl}/?tg_login=${payload}` }]],
    });
  }

  private async reply(chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // not critical
    }
  }
}

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
}
