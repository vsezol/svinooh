import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * The application's Prometheus metrics registry. Counters/histograms are called
 * from code (HTTP, scans, cache, errors); business gauges (wallets, queue depth)
 * live in MetricsCollectorsService via async collect(). Node metrics (CPU/RAM/
 * event loop) are collected automatically.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'svinooh_http_requests_total',
    help: 'HTTP requests total',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'svinooh_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  readonly scans = new Counter({
    name: 'svinooh_scans_total',
    help: 'Wallet scans by result',
    labelNames: ['chain', 'result'] as const, // ok | failed | suppressed
    registers: [this.registry],
  });

  /**
   * The same scans, seen from the pacing model: which lane was this check on.
   * `active` is the fast tier — somebody has the portfolio open and the address
   * is re-read every few minutes; `stale` is the slow lane; `first` is the
   * urgent scan of a freshly pasted address. Incremented only by the wallet
   * service, where the result is applied and the lane is known.
   */
  readonly scanChecks = new Counter({
    name: 'svinooh_scan_checks_total',
    help: 'Scan results by the pacing tier that scheduled them',
    labelNames: ['tier', 'result'] as const, // tier: first | active | stale
    registers: [this.registry],
  });

  /**
   * The fast check: the first reading of a freshly pasted EVM address, answered
   * by the api source (Zerion) in under a second so the spinner is short, with
   * the configured source as fallback. Counted by whoever actually answered —
   * `api`, `browser`, or `none` when nobody could. Incremented by scanner-evm.
   */
  readonly firstReadings = new Counter({
    name: 'svinooh_first_readings_total',
    help: 'First readings of fresh addresses, by the source that answered',
    labelNames: ['source'] as const, // api | browser | none
    registers: [this.registry],
  });

  /**
   * Range crossings the chain reported before a scan was due — the fast path
   * doing its job. It is the number that says whether the live watch is
   * earning its socket: every one of these is a message that went out in
   * seconds instead of at the end of an interval.
   */
  readonly liveCrossings = new Counter({
    name: 'svinooh_live_crossings_total',
    help: 'Position range crossings seen live on-chain, by platform and direction',
    labelNames: ['platform', 'direction'] as const, // direction: in | out
    registers: [this.registry],
  });

  readonly errors = new Counter({
    name: 'svinooh_errors_total',
    help: 'Errors by type',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ app: process.env.SERVICE_NAME || 'svinooh' });
    collectDefaultMetrics({ register: this.registry, prefix: 'svinooh_node_' });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
