import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemFilter } from './api/problems';
import { settingsFromEnv } from './settings';

async function bootstrap(): Promise<void> {
  const settings = settingsFromEnv();
  const app = await NestFactory.create(AppModule.with(), { logger: ['log', 'warn', 'error'] });
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  if (settings.corsOrigins.length > 0) {
    app.enableCors({ origin: settings.corsOrigins, methods: ['GET', 'POST'] });
  }
  await app.listen(settings.port, '::');
}

void bootstrap();
