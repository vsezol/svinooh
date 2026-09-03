import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { REGISTRY, effectiveSettings, validateSettings } from '@svinooh/common';
import type { SettingDto, SettingsDto, UpdateSettingsDto } from '@svinooh/shared';

/**
 * The only thing that writes the `Setting` table.
 *
 * Every knob is declared once, in libs/common/settings/registry.json, and this
 * reads it from there — so a knob added to that file turns up in the panel with
 * the right bounds and the right help without a line of code changing here or
 * in the browser. That file is also what the services themselves read, which is
 * what keeps the panel honest about what is actually in effect.
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

  async list(): Promise<SettingsDto> {
    const rows = await this.prisma.setting.findMany();
    const now = effectiveSettings(rows);
    return {
      settings: REGISTRY.settings.map(
        (spec): SettingDto => ({
          key: spec.key,
          label: spec.label,
          about: spec.about,
          group: spec.group,
          type: spec.type,
          unit: spec.unit ?? null,
          value: now[spec.key],
          default: spec.default,
          min: spec.min ?? null,
          max: spec.max ?? null,
          options: spec.options ?? null,
          live: spec.live,
          readBy: spec.readBy,
        }),
      ),
    };
  }

  /**
   * Store the ones that differ from their default, delete the ones that do not.
   *
   * A row means a decision. Writing every key on every save would turn the
   * table into a second copy of the defaults, and then changing a default in
   * the registry would silently change nothing.
   *
   * A patch: keys left out keep whatever they had, which is what lets the panel
   * send only what the person touched — and what lets the cross-knob rules
   * weigh the system as it would actually be rather than as the form was
   * filled in.
   */
  async update(patch: UpdateSettingsDto, who: string): Promise<SettingsDto> {
    const values = patch?.values ?? {};
    const problems = validateSettings(values, effectiveSettings(await this.prisma.setting.findMany()));
    if (problems.length) {
      throw new BadRequestException({ statusCode: 400, code: 'INVALID_SETTINGS', message: problems });
    }

    const now = new Date();
    const specs = new Map(REGISTRY.settings.map((spec) => [spec.key, spec]));

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const spec = specs.get(key);
      if (!spec) continue;
      const value = spec.type === 'enum' ? String(raw) : Math.round(Number(raw));
      if (value === spec.default) {
        writes.push(this.prisma.setting.deleteMany({ where: { key } }));
        continue;
      }
      const stored = value as Prisma.InputJsonValue;
      writes.push(
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: stored, updatedBy: who, updatedAt: now },
          update: { value: stored, updatedBy: who, updatedAt: now },
        }),
      );
    }
    // All of them or none: a half-applied change could leave the system in a
    // shape neither the operator nor the rules ever agreed to
    await this.prisma.$transaction(writes);

    // Who changed what, in the log as well as the row: a number that turns out
    // to have been a mistake is easier to explain with a timestamp beside it
    this.logger.log(`${who} set ${Object.keys(values).join(', ')}`);
    return this.list();
  }
}
