/**
 * Distributed tracing — the "T" of LGTM (Loki, Grafana, Tempo, Mimir/Prometheus).
 *
 * This module is a SIDE EFFECT. It is deliberately kept out of the package
 * barrel and loaded with `node --require` ahead of the application (see each
 * service's Dockerfile), because instrumentation patches modules as they are
 * required — anything already loaded (http, express, Nest) would never be traced.
 *
 * It only decides. The SDK and its instrumentations live in tracing-sdk.ts and
 * are required only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. They used to be
 * imported at the top of this file, ahead of that check, so every Node service
 * loaded eleven OpenTelemetry packages at boot in order to decide not to use
 * them — and tracing has been off since Tempo was removed.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` unset means tracing is off, so local development
 * and the tests need no collector running.
 */
if ((process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '')) {
  // require, not import(): the SDK has to finish patching before the
  // application's own modules load, and an await would let them go first
  require('./tracing-sdk');
}

export {};
