import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { config } from '../config';
import { TelegramLoginService, type TelegramIdentity } from './telegram-login.service';
import { UserService } from './user.service';

interface StartBody {
  /** The payload from t.me/<bot>?start=<token>, when there was one */
  token?: string;
  from: TelegramIdentity;
}

/**
 * What the bot asks for when somebody talks to it.
 *
 * The bot has no database and creates no users. It hears "Start", asks this for
 * a way in, and sends what comes back — so account creation, portfolios and
 * sign-in links stay in the one service whose job that is, and the bot stays a
 * view of them.
 *
 * This mints a signed-in link for whatever Telegram id it is handed, which
 * makes it the most dangerous endpoint in the system. It is not on the public
 * router by accident of naming: it demands a shared secret, and refuses
 * everything if one was never configured rather than defaulting to open.
 */
@Controller('internal/telegram')
export class InternalTelegramController {
  constructor(
    private readonly logins: TelegramLoginService,
    private readonly users: UserService,
  ) {}

  @Post('start')
  async start(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: StartBody,
  ): Promise<{ kind: 'login' | 'connected'; url: string }> {
    if (!config.internalSecret || secret !== config.internalSecret) {
      throw new ForbiddenException('Not for you');
    }
    if (!body?.from?.id) throw new ForbiddenException('No sender');

    // A connect token means somebody's alerts move into this chat, and nothing
    // else happens: the sender is a delivery address here, not a sign-in — no
    // user is created for them and no login link is minted. The reply must not
    // carry one either: the account whose alerts these are belongs to whoever
    // started the connect on the site, not to whoever opened the chat link.
    if (body.token) {
      const connectUserId = await this.logins.connectTarget(body.token);
      if (connectUserId) {
        await this.users.bindAlertChat(connectUserId, body.from.id);
        await this.logins.consume(body.token);
        return { kind: 'connected', url: config.webUrl };
      }
    }

    // Releases the tab that is waiting on this token, if there is one. A bare
    // "Start" with no token still gets a way in below — somebody who found the
    // bot on their own is a user we would otherwise drop on the floor.
    if (body.token) await this.logins.authenticate(body.token, body.from);

    const user = await this.users.upsertTelegram({
      id: body.from.id,
      firstName: body.from.first_name,
      lastName: body.from.last_name,
      username: body.from.username,
    });
    const portfolio = await this.users.ensurePortfolio(user);
    const key = await this.users.issueLoginLink(user.id);
    return { kind: 'login', url: `${config.webUrl}/p/${portfolio.slug}?login=${key}` };
  }
}
