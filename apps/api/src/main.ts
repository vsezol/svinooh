import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { LokiLogger } from './logging/loki-logger';

async function bootstrap() {
  // bufferLogs — чтобы логи бутстрапа тоже ушли в Loki
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new LokiLogger());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.webOrigin === '*' ? true : config.webOrigin.split(',').map((s) => s.trim()),
  });
  // Чтобы onModuleDestroy закрыл Prisma и headless Chrome при остановке
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('bootstrap').log(`API up: http://localhost:${config.port}/api`);
}

void bootstrap();
