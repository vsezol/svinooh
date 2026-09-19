import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Renewals } from './renewals.service';
import { Slowdown } from './slowdown.service';

/**
 * The two things nobody's scan can trigger: a portfolio that has gone quiet,
 * and a subscription about to end or already ended.
 *
 * Not urgent — what is being announced has been true for a day, or is days
 * away — and each sweep is one indexed query, so a quarter of an hour is
 * generous either way. It was a setInterval in a service of its own; here it
 * is the same clock, declared.
 *
 * Both halves are caught separately: a renewal reminder is not worth losing
 * because a quiet-portfolio query failed.
 */
const EVERY_MS = 15 * 60_000;

@Injectable()
export class Sweeps {
  private readonly logger = new Logger(Sweeps.name);

  constructor(
    private readonly slowdown: Slowdown,
    private readonly renewals: Renewals,
  ) {}

  @Interval('alerts-sweep', EVERY_MS)
  async tick(): Promise<void> {
    try {
      const sent = await this.slowdown.sweep();
      if (sent) this.logger.log(`told ${sent} owner(s) their portfolio had gone quiet`);
    } catch (e) {
      this.logger.warn(`slowdown sweep failed: ${e instanceof Error ? e.message : e}`);
    }
    try {
      const asked = await this.renewals.sweep();
      if (asked) this.logger.log(`asked ${asked} subscriber(s) about their renewal`);
    } catch (e) {
      this.logger.warn(`renewal sweep failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
