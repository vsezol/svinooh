import { Module } from '@nestjs/common';
import { PoolFeed } from './live/pool-feed.service';
import { RangeWatch } from './live/range-watch.service';
import { ScanRequests } from './scan-requests.service';
import { SyncModule } from './sync/sync.module';

/**
 * The scan pipeline, and the line drawn around it.
 *
 * It was a service of its own: same database, same broker, same libraries, one
 * HTTP route the api called to say "scan this now". What the split bought was a
 * process that could be restarted without touching the gateway; what it cost
 * was a deploy target, a Dockerfile, a set of variables, a Prometheus job and a
 * round trip for a call that never waited for its answer. It lives here now,
 * behind a fence kept by hand — the same three rules the admin module keeps:
 *
 *   - One door. `ScanRequests` is the only thing that leaves this module, and
 *     "scan this wallet now" is the only thing it says. Nothing outside
 *     reaches for a scanner, a queue, or the writer.
 *   - Nothing else comes out. The producer, the consumers and the scanners are
 *     private: SyncModule is imported here and exported nowhere.
 *   - Nothing goes in. Inside this directory the only imports are libs —
 *     @svinooh/db, @svinooh/common, @svinooh/shared — and the api's own
 *     config. Never billing, never portfolio.
 *
 * `npm run -w apps/api check:boundary` reads the imports and fails if any of
 * that stops being true.
 *
 * `live/` is the newest thing in here and the one that needs saying out loud:
 * it listens to Solana for the pools somebody holds a Meteora position in, and
 * when the price leaves one of those positions it asks for that wallet to be
 * read NOW. It sends nothing. Everything about who hears what still happens
 * exactly once, downstream, where it always did — the watch only moves the
 * moment of the reading from "when the clock came round" to "when it
 * happened".
 *
 * What did NOT change: the broker. EVM is scanned by apps/scanner-evm, a real
 * service on the other side of scan.evm, so the queues are the contract
 * between two processes and stay exactly as they were. SOL, TRON and BTC are
 * still scanned in this process and their results still go through scan.result
 * — one path for applying a reading, no special case.
 */
@Module({
  imports: [SyncModule],
  providers: [ScanRequests, PoolFeed, RangeWatch],
  exports: [ScanRequests],
})
export class WalletModule {}
