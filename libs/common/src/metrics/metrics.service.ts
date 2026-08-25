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

  readonly cacheOps = new Counter({
    name: 'svinooh_cache_ops_total',
    help: 'Portfolio cache operations',
    labelNames: ['op'] as const, // hit | miss
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
