import { Body, Controller, Get, Headers, HttpException, Post, Query } from '@nestjs/common';
import { config } from '../config';
import { setting } from '@svinooh/common';

/**
 * The api gateway does not own auth — it forwards /auth/* to the auth service
 * (internal HTTP). The auth service runs the Telegram bot, issues JWTs and
 * upserts users; the api only verifies JWTs (via the shared guard) on its own
 * routes. /auth/config is enriched with syncIntervalMin, which the api owns.
 */
async function forward(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string | undefined>; auth?: string } = {},
): Promise<unknown> {
  const url = new URL(`${config.authServiceUrl}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) if (v != null) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth) headers['authorization'] = opts.auth;
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new HttpException(data as Record<string, unknown>, res.status);
  return data;
}

@Controller('auth')
export class AuthProxyController {
  @Get('config')
  async getConfig(): Promise<Record<string, unknown>> {
    const cfg = (await forward('GET', '/auth/config')) as Record<string, unknown>;
    return { ...cfg, syncIntervalMin: setting('sync.activeIntervalMin') };
  }

  @Post('telegram')
  telegram(@Body() body: unknown) {
    return forward('POST', '/auth/telegram', { body });
  }

  @Post('telegram/start')
  telegramStart() {
    return forward('POST', '/auth/telegram/start', { body: {} });
  }

  @Get('telegram/poll')
  telegramPoll(@Query('token') token?: string) {
    return forward('GET', '/auth/telegram/poll', { query: { token } });
  }

  @Post('link')
  link(@Body() body: unknown) {
    return forward('POST', '/auth/link', { body });
  }

  @Post('dev')
  dev(@Body() body: unknown) {
    return forward('POST', '/auth/dev', { body });
  }

  @Get('me')
  me(@Headers('authorization') auth?: string) {
    return forward('GET', '/auth/me', { auth });
  }
}
