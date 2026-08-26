import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { sleep } from '../common/util';
import { UserService } from './user.service';

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
 * bot, they press Start → Telegram sends the bot "/start <token>". We read
 * updates via getUpdates long-polling (one consumer per bot; the service runs
 * as a single replica). The update comes from Telegram under our bot token, so
 * `from` is already authentic — HMAC, as in the web widget, isn't needed here.
 *
 * The tokens here are only for the tab that is waiting: they live five minutes,
 * in memory, and are consumed by the first poll. The way back into the site is
 * a separate, durable sign-in link (UserService.issueLoginLink) — the reply
 * below carries it, so returning does not depend on that original tab still
 * existing, or on being the same device.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly tokens = new Map<string, LoginToken>();
  private running = false;
  private offset = 0;

  constructor(private readonly users: UserService) {}

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

  /**
   * Every message in the chat is answered with a way in. A payload from
   * `t.me/<bot>?start=<token>` also releases the tab that is waiting on that
   * token, but nothing depends on it: a bare "/start", a stale token, or plain
   * "hi" all get the same working link. Someone who found the bot on their own
   * is a user we would otherwise drop on the floor.
   */
  private handleUpdate(update: TgUpdate): void {
    const msg = update.message;
    if (!msg?.from || msg.from.is_bot) return;
    // Only ever in a one-to-one chat. The reply carries a link that signs its
    // opener in as the sender, which in a group would hand the sender's account
    // to everyone who can read it.
    if (msg.chat.type !== 'private') return;
    const text = msg.text ?? '';
    const payload = text.startsWith('/start') ? text.slice('/start'.length).trim() : '';

    const from = msg.from;
    const entry = payload ? this.tokens.get(payload) : undefined;
    if (entry && Date.now() - entry.createdAt <= TOKEN_TTL_MS) {
      entry.status = 'authenticated';
      entry.user = {
        id: from.id,
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
      };
      this.logger.log(`Login confirmed by bot: @${from.username ?? from.id}`);
    }
    void this.sendWayIn(msg.chat.id, from);
  }

  /**
   * The way back to the site, as a button *and* as the URL in plain text.
   *
   * The button is the obvious thing to press and it opens inside Telegram's own
   * browser, which is a place people get stuck: it is slow, it is a fresh
   * profile, and on a phone it may not even be the device the sign-in started
   * on. The plain URL is there so it can be long-pressed into a real browser,
   * copied, or opened on another machine entirely — and because the link
   * carries a sign-in of its own, all of those arrive signed in.
   */
  private async sendWayIn(chatId: number, from: TgFrom): Promise<void> {
    let url = config.webUrl;
    try {
      const user = await this.users.upsertTelegram({
        id: from.id,
        firstName: from.first_name,
        lastName: from.last_name,
        username: from.username,
      });
      const portfolio = await this.users.ensurePortfolio(user);
      const key = await this.users.issueLoginLink(user.id);
      url = `${config.webUrl}/p/${portfolio.slug}?login=${key}`;
    } catch (error) {
      this.logger.warn(
        `Could not build a sign-in link: ${error instanceof Error ? error.message : error}`,
      );
    }
    await this.reply(
      chatId,
      `✅ Signed in.\n\n${url}\n\nThat link opens your portfolio and signs you in — on this phone, on your laptop, in any browser. Good for 24 hours; send /start for a new one.`,
      { inline_keyboard: [[{ text: 'Open my portfolio →', url }]] },
    );
  }

  private async reply(chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          // The link is there to be read and pressed, not to be turned into a
          // preview card the size of the message
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // not critical
    }
  }
}

interface TgFrom {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: TgFrom;
  };
}
