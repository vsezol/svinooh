import Fastify from 'fastify';
import { ALERTS_QUEUE, BILLING_QUEUE, NOTICES_QUEUE, QueueService } from '@svinooh/common';
import type { AlertEvent, BillingNotice, SlowedNotice } from '@svinooh/shared';
import { config } from './config';
import { esc, formatAlert, formatBillingNotice, formatSlowedNotice } from './format';
import { getUpdates, send, type TgUpdate } from './telegram';

/**
 * The Telegram bot, as its own service.
 *
 * It is a view and a pair of ears: it says what it is told to say and it
 * forwards what it hears. It has no database, creates no accounts and knows
 * nothing about portfolios — when somebody presses Start it asks the auth
 * service for a way in and sends what comes back, which is what keeps account
 * creation in the one service whose job that is.
 *
 * It has to be its own service rather than a module of auth, because Telegram
 * allows exactly one long-poll consumer per bot token. Two replicas of auth
 * would fight over updates; the bot runs as one.
 */
async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.get('/health', async () => ({ ok: true }));

  const queue = new QueueService(config.queueUrl || null);
  await queue.onApplicationBootstrap();

  if (queue.enabled) {
    // Manual ack, so a Telegram outage delays a warning rather than losing it:
    // the message stays on the queue until it has actually been sent
    queue.consume<AlertEvent>(
      ALERTS_QUEUE,
      async (event) => {
        const { text, markup } = formatAlert(event, config.webUrl);
        await send(event.telegramId, text, markup);
      },
      4,
    );
    // Same manual ack for the same reason: a notice is worth delivering late
    // and not worth losing
    queue.consume<SlowedNotice>(
      NOTICES_QUEUE,
      async (notice) => {
        const { text, markup } = formatSlowedNotice(notice, config.webUrl);
        await send(notice.telegramId, text, markup);
      },
      4,
    );
    // Money messages most of all: a lost renewal reminder is churn
    queue.consume<BillingNotice>(
      BILLING_QUEUE,
      async (notice) => {
        const { text, markup } = formatBillingNotice(notice, config.webUrl);
        await send(notice.telegramId, text, markup);
      },
      4,
    );
    app.log.info(`listening on ${ALERTS_QUEUE}, ${NOTICES_QUEUE} and ${BILLING_QUEUE}`);
  } else {
    app.log.warn('REDIS_URL not set — alerts will not be delivered');
  }

  let running = true;
  if (config.botToken) {
    void poll(() => running, app.log);
    app.log.info('long-polling Telegram');
  } else {
    app.log.warn('TELEGRAM_BOT_TOKEN not set — the bot will not answer anybody');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });

  const stop = async () => {
    running = false;
    await queue.onModuleDestroy();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

interface Log {
  warn: (message: string) => void;
  error: (message: string) => void;
}

async function poll(running: () => boolean, log: Log): Promise<void> {
  let offset = 0;
  while (running()) {
    try {
      for (const update of await getUpdates(offset)) {
        offset = update.update_id + 1;
        void answer(update, log);
      }
    } catch {
      // A long-poll timeout is the normal case, not a failure. Anything else is
      // the network, and the next pass will find out.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Every message gets a way in.
 *
 * A payload from `t.me/<bot>?start=<token>` also releases the browser tab
 * waiting on that token, but nothing depends on it: a bare Start, a stale token
 * or plain "hi" all get the same working link. Somebody who found the bot on
 * their own is a user we would otherwise drop on the floor.
 */
async function answer(update: TgUpdate, log: Log): Promise<void> {
  const message = update.message;
  if (!message?.from || message.from.is_bot) return;
  // Only ever one to one. The reply carries a link that signs its opener in as
  // the sender, which in a group would hand the sender's account to everyone
  // who can read it.
  if (message.chat.type !== 'private') return;

  const text = message.text ?? '';
  const token = text.startsWith('/start') ? text.slice('/start'.length).trim() : '';

  try {
    // Not under /auth: that prefix belongs to the routes the public gateway
    // proxies, and this one is only ever reached over the private network,
    // which is what /internal means everywhere here
    const res = await fetch(`${config.authUrl}/internal/telegram/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.internalSecret ? { 'x-internal-secret': config.internalSecret } : {}),
      },
      body: JSON.stringify({ token: token || undefined, from: message.from }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`auth ${res.status}`);
    const { kind, url } = (await res.json()) as { kind?: 'login' | 'connected'; url: string };
    if (kind === 'connected') {
      // The chat became somebody's alert delivery address — deliberately no
      // sign-in link: the account belongs to whoever started this on the site
      await send(
        message.chat.id,
        'Alerts connected. This chat will now receive portfolio alerts from svinooh.',
        { inline_keyboard: [[{ text: 'Back to svinooh →', url }]] },
      );
      return;
    }
    // Messages go out as HTML, so the link is escaped on the way into the text
    // even though today's tokens carry nothing that needs it — a query string
    // grows an `&` the first time somebody adds a second parameter
    await send(
      message.chat.id,
      `Signed in.\n\n${esc(url)}\n\nThat link opens your portfolio and signs you in — on this phone, on your laptop, in any browser. Good for an hour; send /start for a new one.`,
      { inline_keyboard: [[{ text: 'Open my portfolio →', url }]] },
    );
  } catch (error) {
    log.warn(`could not answer ${message.from.id}: ${(error as Error).message}`);
    // Better than silence: somebody who pressed Start and got nothing assumes
    // the product is broken
    await send(message.chat.id, 'Something went wrong signing you in. Try /start again in a moment.').catch(
      () => undefined,
    );
  }
}

void main();
