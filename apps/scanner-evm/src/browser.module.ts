import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { closeBrowser } from './scanners/browser';

/**
 * Exists for one reason: to close Chromium when the process is asked to stop.
 * A browser left behind outlives the container's grace period and gets killed,
 * which on a restart loop means a machine slowly filling with zombie Chromes.
 */
@Module({})
export class BrowserModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeBrowser();
  }
}
