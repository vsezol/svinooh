import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { LokiLogger } from '@svinooh/common';

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
  new Logger('bootstrap').log(`API up: http://localhost:${config.port}/api`);
}

void bootstrap();
