import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { RequiredAuthGuard, type AuthedRequest } from '@svinooh/common';
import type { SettingsDto } from '@svinooh/shared';
import { AdminGuard } from '../admin.guard';
import { SettingsService } from './settings.service';

/**
 * The tunables, for the people allowed to turn them.
 *
 * Two guards, in this order and never one without the other: the first says
 * who is asking, the second asks the database whether that person is an admin.
 * Both answer NotFound, so from outside this address is indistinguishable from
 * one that does not exist.
 */
@Controller('admin/settings')
@UseGuards(RequiredAuthGuard, AdminGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): Promise<SettingsDto> {
    return this.settings.list();
  }

  @Put()
  update(
    @Req() req: AuthedRequest,
    // The body is the patch itself, unknown until the service has checked it
    // against the registry — which is what decides what a valid body is
    @Body() patch: unknown,
  ): Promise<SettingsDto> {
    // The guards have run, so there is a userId — and a row records who changed it
    return this.settings.update(patch, req.userId as string);
  }
}
