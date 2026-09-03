import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { RequiredAuthGuard, type AuthedRequest } from '@svinooh/common';
import type { SettingsDto } from '@svinooh/shared';
import { AdminClient } from './admin.client';
import { AdminGuard } from './admin.guard';

/**
 * The way into the admin service, and the only one.
 *
 * Two locks, and they check different things. AdminGuard verifies the caller
 * against the database; the admin service then checks the shared secret, so a
 * request that did not come through here gets nowhere. Both answer NotFound, so
 * the two are indistinguishable from outside.
 */
@Controller('admin')
@UseGuards(RequiredAuthGuard, AdminGuard)
export class AdminProxyController {
  constructor(private readonly admin: AdminClient) {}

  @Get('settings')
  settings(@Req() req: AuthedRequest): Promise<SettingsDto> {
    return this.admin.settings(req.userId as string);
  }

  @Put('settings')
  save(@Req() req: AuthedRequest, @Body() body: unknown): Promise<SettingsDto> {
    return this.admin.save(req.userId as string, body);
  }
}
