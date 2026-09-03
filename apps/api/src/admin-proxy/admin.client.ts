import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { SettingsDto } from '@svinooh/shared';
import { config } from '../config';

/**
 * The api's side of the call to the admin service.
 *
 * The service is a separate process with no ingress of its own, so reaching it
 * means an HTTP call over the private network — there is no in-process
 * shortcut, and adding one would put the admin's database access back inside
 * the public gateway.
 *
 * The shared secret is what makes the call legitimate: the service refuses
 * anything without it, so a request that did not come through this gateway gets
 * nowhere even if the service were somehow reachable. The caller's id rides
 * along so a stored row records who changed it.
 */
const TIMEOUT_MS = 20_000;

@Injectable()
export class AdminClient {
  settings(userId: string): Promise<SettingsDto> {
    return this.call<SettingsDto>('GET', userId);
  }

  save(userId: string, body: unknown): Promise<SettingsDto> {
    return this.call<SettingsDto>('PUT', userId, body);
  }

  private async call<T>(method: 'GET' | 'PUT', userId: string, body?: unknown): Promise<T> {
    // Without the secret there is no legitimate way to ask, and saying so would
    // itself confirm the surface exists
    if (!config.internalSecret) throw new NotFoundException();

    const res = await fetch(`${config.adminServiceUrl}/internal/settings`, {
      method,
      headers: {
        'x-internal-secret': config.internalSecret,
        'x-admin-user': userId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = await this.body(res);
    // The service's own refusals are the useful ones — a bound, an option, a
    // rule — so they are passed through rather than flattened into a 502
    if (!res.ok) throw new HttpException(payload, res.status);
    return payload as T;
  }

  /** JSON when it is JSON, and the raw text as a message when it is not */
  private async body(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { message: text };
    }
  }
}
