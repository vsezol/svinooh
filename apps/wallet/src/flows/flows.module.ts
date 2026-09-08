import { Module } from '@nestjs/common';
import { FlowSyncService } from './flow-sync.service';

/**
 * Transfer ingestion. Its own module rather than a provider inside SyncModule:
 * it shares nothing with the balance pipeline — no queue, no scan lease, no
 * drop arbitration — and keeping them apart is what lets the whole experiment
 * be switched off by not importing this.
 *
 * ScheduleModule is already rooted by SyncModule, which the app imports beside
 * this one, so the @Interval here is driven by that.
 */
@Module({ providers: [FlowSyncService] })
export class FlowsModule {}
