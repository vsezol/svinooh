import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

/**
 * The admin service.
 *
 * It exists so that the code and the routes that change how the system runs are
 * not part of the thing everybody else talks to. No public domain, one prefix
 * (/internal), and a guard that answers NotFound to anything without the shared
 * secret — so the api is the only way in, and the api has already checked that
 * the caller is an admin in the database.
 *
 * It does not serve a UI. The panel is a lazily-loaded tab in the web app,
 * which keeps the two concerns apart: this owns the authority, that owns the
 * rendering.
 */
async function main(): Promise<void> {
  // No ValidationPipe: the only body this service takes is a bag of settings,
  // and validateSettings checks it against the registry — bounds, options and
  // the rules between knobs, which a decorator could not express anyway
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port, '0.0.0.0');
  const logger = new Logger('bootstrap');
  logger.log(`Admin service up on :${config.port}`);
  if (!config.internalSecret) {
    logger.error('INTERNAL_SECRET is not set — every route will answer 404 until it is');
  }
}

void main();
