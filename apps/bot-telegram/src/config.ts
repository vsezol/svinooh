/**
 * Everything the bot reads from its environment.
 *
 * It has no database. Everything it needs to answer somebody is either in the
 * message or one call away, which is what keeps account creation in the service
 * whose job that is.
 */
export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  /** Where sign-in links come from */
  authUrl: (process.env.AUTH_URL || 'http://auth:3000').replace(/\/+$/, ''),
  /** What lets us ask for one. Without it the auth service refuses, correctly. */
  internalSecret: process.env.INTERNAL_SECRET || null,
  rabbitUrl: process.env.RABBITMQ_URL ?? '',
  /** Public URL of the site — the button under every message */
  webUrl: (process.env.WEB_URL || 'https://svinooh.com').replace(/\/+$/, ''),
  port: Number(process.env.PORT ?? 3000),
};
