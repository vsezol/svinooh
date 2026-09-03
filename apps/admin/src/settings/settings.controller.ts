import { Body, Controller, Get, Headers, Put, UseGuards } from '@nestjs/common';
import type { SettingsDto } from '@svinooh/shared';
import { InternalGuard } from '../internal.guard';
import { SettingsService } from './settings.service';

/**
 * Under /internal, like the wallet service's scan hook: this prefix is never
 * proxied by the public gateway, and the guard refuses anything that did not
 * come from the api with the shared secret.
 */
@Controller('internal/settings')
@UseGuards(InternalGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): Promise<SettingsDto> {
    return this.settings.list();
  }

  @Put()
  update(
    // The body is the patch itself, unknown until the service has checked it
    // against the registry — which is what decides what a valid body is
    @Body() patch: unknown,
    // The api puts the admin's own id here, so a row records who changed it
    @Headers('x-admin-user') who?: string,
  ): Promise<SettingsDto> {
    return this.settings.update(patch, who || 'admin');
  }
}
