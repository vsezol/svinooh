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
 * Вход через бота по deep-link: сайт создаёт токен и открывает
 * t.me/<bot>?start=<token> → у пользователя открывается приложение Telegram
 * на боте, он жмёт Start → Telegram присылает боту "/start <token>". Апдейты
 * читаем long-polling'ом getUpdates (один потребитель на бот; сервис в 1
 * реплике). Апдейт приходит от Telegram по нашему токену бота, поэтому
 * `from` уже аутентичен — HMAC, как в веб-виджете, тут не нужен.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly tokens = new Map<string, LoginToken>();
  private running = false;
  private offset = 0;

  onApplicationBootstrap() {
    if (!config.botToken) {
      this.logger.log('TELEGRAM_BOT_TOKEN не задан — вход через бота выключен');
      return;
    }
    this.running = true;
    void this.pollLoop();
    this.logger.log('Long-polling бота запущен');
  }

  onModuleDestroy() {
    this.running = false;
  }

  /** Создать pending-токен для нового логина */
  create(token: string): void {
    this.cleanup();
    this.tokens.set(token, { status: 'pending', createdAt: Date.now() });
  }

  /** Текущее состояние токена (null — нет или протух) */
  get(token: string): LoginToken | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  /** Забрать аутентифицированный токен (одноразово) */
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
        // таймаут long-poll или сетевой сбой — просто продолжаем
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
    this.logger.log(`Логин подтверждён ботом: @${msg.from.username ?? msg.from.id}`);
    void this.reply(msg.chat.id, '✅ Готово! Возвращайся на сайт — ты вошёл в svinooh.');
  }

  private async reply(chatId: number, text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // не критично
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
