import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';

/**
 * Sign-in with X (Twitter), as OAuth 2.0 authorization code with PKCE.
 *
 * The shape mirrors what the flow needs and nothing more: `start` builds the
 * authorize URL the browser is sent to, `callback` turns the code X sends back
 * into a profile. Between the two nothing is stored here — the PKCE verifier
 * rides inside the `state` parameter as a short-lived signed JWT, so any
 * instance can finish a flow any instance started, the same reason the
 * Telegram flow keeps its pending logins in the database rather than a Map.
 * The verifier is not a secret on its own: exchanging the code also takes the
 * client secret, which never leaves this service.
 */

/** Everything the callback needs to finish what start began */
interface XState {
  purpose: 'x-oauth';
  verifier: string;
}

/** What we read off the profile — the same fields Telegram gives us */
export interface XProfile {
  id: string;
  name?: string;
  username?: string;
  photoUrl?: string;
}

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url';

/** users.read answers /2/users/me, and X will not grant it without tweet.read */
const SCOPE = 'users.read tweet.read';

/** How long a sign-in may sit on X's consent screen before we stop honouring it */
const STATE_TTL = '15m';

@Injectable()
export class XLoginService {
  constructor(private readonly jwt: JwtService) {}

  get enabled(): boolean {
    return !!(config.xClientId && config.xClientSecret);
  }

  /** Where X sends the browser back to — a page of ours that finishes the flow */
  private get redirectUri(): string {
    return `${config.webUrl}/auth/x/callback`;
  }

  private assertConfigured(): void {
    if (!this.enabled) throw new ServiceUnavailableException('X sign-in is not configured');
  }

  async start(): Promise<{ url: string }> {
    this.assertConfigured();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = await this.jwt.signAsync({ purpose: 'x-oauth', verifier } satisfies XState, {
      expiresIn: STATE_TTL,
    });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.xClientId as string);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString() };
  }

  /** The browser came back: trade the code for a profile */
  async callback(code: string, state: string): Promise<XProfile> {
    this.assertConfigured();
    if (!code || !state) throw new BadRequestException('Missing code or state');

    let parsed: XState;
    try {
      parsed = await this.jwt.verifyAsync<XState>(state);
    } catch {
      throw new UnauthorizedException('Sign-in session expired, start again');
    }
    // The same secret signs session tokens; the purpose claim is what keeps a
    // stolen session JWT from doubling as an OAuth state and vice versa
    if (parsed.purpose !== 'x-oauth' || !parsed.verifier) {
      throw new UnauthorizedException('Sign-in session expired, start again');
    }

    const accessToken = await this.exchange(code, parsed.verifier);
    return this.profile(accessToken);
  }

  private async exchange(code: string, verifier: string): Promise<string> {
    const basic = Buffer.from(`${config.xClientId}:${config.xClientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // The code is single-use and short-lived; a reload of the callback page
      // replays it and lands here. Said as "start again", not as our failure.
      throw new UnauthorizedException('X did not accept the sign-in, start again');
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new UnauthorizedException('X did not accept the sign-in, start again');
    return data.access_token;
  }

  private async profile(accessToken: string): Promise<XProfile> {
    const res = await fetch(ME_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ServiceUnavailableException('X did not answer for the profile');
    const data = (await res.json()) as {
      data?: { id?: string; name?: string; username?: string; profile_image_url?: string };
    };
    const who = data.data;
    if (!who?.id) throw new ServiceUnavailableException('X did not answer for the profile');
    return {
      id: who.id,
      name: who.name,
      username: who.username,
      // X hands out the 48px thumbnail; the account page has a real one
      photoUrl: who.profile_image_url?.replace('_normal.', '_400x400.'),
    };
  }
}
