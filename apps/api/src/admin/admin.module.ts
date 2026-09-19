import { Module } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { AdminGuard } from './admin.guard';
import { ModelsService } from './settings/models.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

/**
 * The admin, and the line drawn around it.
 *
 * It used to be its own service on the private network, reached by an HTTP
 * call the api made to itself with a shared secret. That bought one real
 * thing — the code that writes the tunables ran in a different process from
 * the public gateway — and cost a deploy target, a Dockerfile, a set of
 * variables and a network hop, for two routes. It lives here now.
 *
 * What replaces the process boundary is this module, and the rules are the
 * same rules a service has, kept by hand:
 *
 *   - One door. Every route it owns hangs off SettingsController, behind
 *     RequiredAuthGuard then AdminGuard. There is no admin route anywhere
 *     else in the api.
 *   - Nothing comes out. `exports` is empty and stays empty: no other module
 *     may reach SettingsService, because the write path to the `Setting`
 *     table is the thing being fenced off, and a provider another module can
 *     inject is not fenced off.
 *   - Nothing goes in. Inside this directory the only imports are libs —
 *     @svinooh/db, @svinooh/common, @svinooh/shared. Never billing, never
 *     portfolio, never a sibling here. A dependency on a feature module is
 *     what would make this a part of the api rather than a tenant in it.
 *
 * `npm run -w apps/api check:boundary` reads the imports and fails if any of
 * that stops being true.
 */
@Module({
  controllers: [SettingsController],
  providers: [AdminGuard, RequiredAuthGuard, SettingsService, ModelsService],
})
export class AdminModule {}
