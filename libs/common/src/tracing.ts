/**
 * Distributed tracing — the "T" of LGTM (Loki, Grafana, Tempo, Mimir/Prometheus).
 *
 * This module is a SIDE EFFECT: importing it starts the SDK. It is deliberately
 * kept out of the package barrel and loaded with `node --require` ahead of the
 * application (see each service's Dockerfile), because instrumentation patches
 * modules as they are required — anything already loaded (http, express, Nest)
 * would never be traced.
 *
 * Spans go over OTLP/HTTP to Tempo, which Grafana reads: one request through
 * web → api → auth/wallet → Postgres/Redis/RabbitMQ becomes a single trace.
 * `OTEL_EXPORTER_OTLP_ENDPOINT` unset means tracing is off, so local
 * development and the tests need no collector running.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '');

if (endpoint) {
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
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          return url.startsWith('/health') || url.includes('/metrics');
        },
        // Same on the way out: shipping logs to Loki must not create a span per batch
        ignoreOutgoingRequestHook: (options) =>
          String((options as { path?: string }).path || '').includes('/loki/api/'),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new IORedisInstrumentation(),
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
}
