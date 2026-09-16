/**
 * The tracing SDK. Requiring this module starts it, so nothing imports it
 * directly: tracing.ts requires it, and only when tracing is on.
 *
 * Spans go over OTLP/HTTP to Tempo, which Grafana reads: one request through
 * web → api → auth/wallet → Postgres/Redis/RabbitMQ becomes a single trace.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '');

/**
 * Traffic that runs every few seconds and says nothing about user activity:
 * health checks, the Prometheus scrape, shipping log batches to Loki. Left in,
 * it would outnumber the real traces several times over.
 */
const isNoise = (path: string): boolean =>
  path.includes('/health') || path.includes('/metrics') || path.includes('/loki/api/');

if (process.env.OTEL_DEBUG) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME || 'svinooh',
    [ATTR_SERVICE_VERSION]: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    'deployment.environment': process.env.RAILWAY_ENVIRONMENT_NAME || 'local',
  }),
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
  instrumentations: [
    new HttpInstrumentation({
      // Health checks and the metrics scrape run every few seconds and say
      // nothing about user traffic — they'd bury the real traces
      ignoreIncomingRequestHook: (req) => isNoise(req.url || ''),
      // Same on the way out: shipping logs to Loki must not create a span per batch
      ignoreOutgoingRequestHook: (options) =>
        isNoise(String((options as { path?: string }).path || '')),
    }),
    // The gateway calls auth and wallet with global fetch, which runs on
    // undici — a different code path from the `http` module, and the one that
    // carries the traceparent header onward. Without this a request stops at
    // the api and never joins up with the service it called.
    new UndiciInstrumentation({
      ignoreRequestHook: (request) => isNoise(request.path || ''),
    }),
    new ExpressInstrumentation(),
    new NestInstrumentation(),
    new AmqplibInstrumentation(),
    new PrismaInstrumentation(),
  ],
});

sdk.start();
// eslint-disable-next-line no-console
console.log(`[tracing] OTLP traces → ${endpoint}`);

const shutdown = () => {
  void sdk.shutdown().catch(() => {});
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
