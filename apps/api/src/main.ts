import 'reflect-metadata';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { PrismaService } from '@svinooh/db';
import { LokiLogger, startSettings } from '@svinooh/common';

async function bootstrap() {
  // bufferLogs — so that bootstrap logs also go to Loki
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new LokiLogger());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.webOrigin === '*' ? true : config.webOrigin.split(',').map((s) => s.trim()),
  });
  // So that onModuleDestroy closes Prisma and headless Chrome on shutdown
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  followSettings(app);
  new Logger('bootstrap').log(`API up: http://localhost:${config.port}/api`);
}

/**
 * Follow the tunables table from here on.
 *
 * Started after the app is up and never awaited: every knob falls back to the
 * environment and then to its declared default, so a database that is slow or
 * briefly unreachable delays the operator's last change and nothing else. See
 * libs/common/src/settings.ts.
 */
function followSettings(app: INestApplicationContext): void {
  const prisma = app.get(PrismaService);
  const log = new Logger('settings');
  startSettings(
    () => prisma.setting.findMany({ select: { key: true, value: true } }),
    (error) => log.warn(`could not read settings: ${error.message}`),
  );
}

void bootstrap();
