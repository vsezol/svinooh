import 'reflect-metadata';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LokiLogger, startSettings } from '@svinooh/common';
import { AppModule } from './app.module';
import { config } from './config';
import { PrismaService } from '@svinooh/db';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new LokiLogger());
  // Closes Prisma, RabbitMQ and headless Chrome on shutdown
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  followSettings(app);
  new Logger('bootstrap').log(`Wallet service up on :${config.port}`);
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
