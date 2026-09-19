import { Module } from '@nestjs/common';
import { AlertsCollector } from './collector.service';
import { Renewals } from './renewals.service';
import { Slowdown } from './slowdown.service';
import { Sweeps } from './sweeps.service';
import { Trial } from './trial.service';

/**
 * Who should be told what, and the line drawn around it.
 *
 * This was `monitor-alerts`, a service whose entire input was one queue —
 * `wallet.state` — that the scan pipeline published to and nothing else read.
 * One producer, one consumer, and a message that existed only because they
 * were two processes: the scan wrote the positions to Postgres, published a
 * copy of them, and the other end read the memberships back out of the same
 * database to decide what to say. The queue is gone; the writer calls
 * `AlertsCollector.handle` directly, with the same event as an argument.
 *
 * What did NOT go is the work. Deciding what changed, against whose
 * thresholds, and whether their trial still has messages in it is the product
 * — it was never the queue's doing. The three queues that leave here
 * (alerts.telegram, notices.telegram, billing.telegram) stay exactly as they
 * were: the bot is a real service on the other side of them.
 *
 * The fence, kept by hand and checked by `check:boundary`:
 *   - One door. `AlertsCollector` — "here is what this wallet looks like now"
 *     — is all that leaves. The trial meter, the sweeps and the transition
 *     rules are private.
 *   - Nothing goes in. Inside this directory the only imports are libs.
 *     It does not know the scan pipeline exists; it is told.
 */
@Module({
  providers: [AlertsCollector, Trial, Slowdown, Renewals, Sweeps],
  exports: [AlertsCollector],
})
export class AlertsModule {}
