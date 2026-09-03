import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequiredAuthGuard, type AuthedRequest } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { SettingsDto, UpdateSettingsDto } from '@svinooh/shared';
import { config } from '../config';

/**
 * The way into the admin service, and the only one.
 *
 * Two locks, and they check different things. This one verifies the caller's
 * token and then asks the DATABASE whether they are an admin — never the token,
 * which was minted before the flag could have been revoked. The admin service
 * then checks the shared secret, so a request that did not come through here
 * gets nowhere even if the service were somehow reachable.
 *
 * A non-admin gets NotFound, not Forbidden. Forbidden would confirm that there
 * is an admin surface and that this is its address; NotFound says the same
 * thing an unauthenticated stranger and a wrong URL say. It is the same answer
 * the admin service itself gives, so the two are indistinguishable from
 * outside.
 */
@Controller('admin')
@UseGuards(RequiredAuthGuard)
export class AdminProxyController {
  constructor(private readonly prisma: PrismaService) {}

  private async forward(
    method: 'GET' | 'PUT',
    path: string,
    userId: string,
    body?: unknown,
  ): Promise<unknown> {
    // Read per request. An admin flag taken away should stop working now, not
    // when their session happens to expire.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!user?.isAdmin) throw new NotFoundException();
    if (!config.internalSecret) throw new NotFoundException();

    const res = await fetch(`${config.adminServiceUrl}${path}`, {
      method,
      headers: {
        'x-internal-secret': config.internalSecret,
        'x-admin-user': userId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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

  @Get('settings')
  settings(@Req() req: AuthedRequest): Promise<unknown> {
    return this.forward('GET', '/internal/settings', req.userId as string);
  }

  @Put('settings')
  save(@Req() req: AuthedRequest, @Body() body: UpdateSettingsDto): Promise<unknown> {
    return this.forward('PUT', '/internal/settings', req.userId as string, body);
  }
}

export type { SettingsDto };
