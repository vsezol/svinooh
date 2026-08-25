import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.webOrigin === '*' ? true : config.webOrigin.split(',').map((s) => s.trim()),
  });
  // Чтобы onModuleDestroy закрыл Prisma и headless Chrome при остановке
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('bootstrap').log(`API поднят: http://localhost:${config.port}/api`);
}

void bootstrap();
