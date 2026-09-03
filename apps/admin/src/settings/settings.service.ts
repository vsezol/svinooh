import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@svinooh/db';
import {
  REGISTRY,
  effectiveSettings,
  parseSettingsPatch,
  settingsView,
  type SettingKey,
  type SettingValue,
  type SettingsPatch,
} from '@svinooh/common';
import type { SettingsDto } from '@svinooh/shared';

/**
 * The only thing that writes the `Setting` table.
 *
 * Every knob is declared once, in libs/common/src/settings/registry.ts, and
 * both this and the services that read it work off that declaration — so a knob
 * added there turns up in the panel with the right bounds and the right help
 * without a line of code changing here or in the browser.
 *
 * It reads the rows straight from the database rather than through the polling
 * cache every other service uses. That cache is up to fifteen seconds behind,
 * and this is the process that just wrote to it: going through it would show
 * somebody their own change had not taken.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async current() {
    return effectiveSettings(await this.prisma.setting.findMany());
  }

  async list(): Promise<SettingsDto> {
    return { settings: settingsView(await this.current()) };
  }

  /**
   * Apply a change, or say why it cannot be applied.
   *
   * The body is unknown until parseSettingsPatch has had it: that one call
   * checks every value against its knob's bounds or options, and then checks
   * the knobs against each other. What comes back is typed, so nothing below
   * has to look at a value and wonder.
   */
  async update(body: unknown, who: string): Promise<SettingsDto> {
    const parsed = parseSettingsPatch(body, await this.current());
    if (!parsed.ok) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_SETTINGS',
        message: parsed.problems,
      });
    }

    await this.write(parsed.patch, who);
    this.logger.log(`${who} set ${Object.keys(parsed.patch).join(', ') || 'nothing'}`);
    return this.list();
  }

  /**
   * Store the ones that differ from their default, delete the ones that do not.
   *
   * A row means a decision. Writing every key on every save would turn the
   * table into a second copy of the defaults, and then changing a default in
   * the registry would silently change nothing.
   *
   * All of them or none: a half-applied change could leave the system in a
   * shape neither the operator nor the rules ever agreed to.
   */
  private async write(patch: SettingsPatch, who: string): Promise<void> {
    const updatedAt = new Date();
    const entries = Object.entries(patch) as Array<[SettingKey, SettingValue]>;

    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        value === REGISTRY[key].default
          ? this.prisma.setting.deleteMany({ where: { key } })
          : this.prisma.setting.upsert({
              where: { key },
              create: { key, value, updatedBy: who, updatedAt },
              update: { value, updatedBy: who, updatedAt },
            }),
      ),
    );
  }
}
