# The agent service, taken to production shape

One MR per step. Each leaves the service working and deployable, each teaches
one thing, and each is small enough to read in a sitting. What the service is
for is in [DESIGN.md](DESIGN.md); this is the order in which the code catches
up with it.

## Where this starts

`apps/agent` had the right boundaries and the wrong wiring. Ports as
protocols and a clean domain, but everything assembled at import time, five
cached singletons the tests cleared by hand, the portfolio as untyped dicts,
use-case decisions inside the route handlers, and a new HTTP connection for
every call to the host. No lockfile, no CI, no metrics.

The rule every step moves towards: `api` depends on `application`,
`application` on `domain`; `agent` and `infrastructure` implement the ports
`application` declares; `container.py` is the only module that knows all of
them.

## Steps

| # | step | lesson |
| --- | --- | --- |
| 1 | Toolchain: `pyproject.toml` + `uv.lock`, ruff, mypy, CI, a non-root multi-stage image, lifespan | reproducible builds; `>=` in production is a bug |
| 2 | Settings: pydantic-settings; a `Panel` port for the admin panel's values instead of module globals | configuration as an object; fail fast at boot |
| 3 | Composition root: a `Container` built by `create_app`, started and stopped by the lifespan, `Depends` on the routes, no import-time singletons; tests that build a container instead of patching internals | dependency injection without a framework; import-time side effects |
| 4 | Domain: a typed portfolio (frozen dataclasses) behind an anti-corruption layer; the arithmetic moves to `domain/` with unit tests | value objects; parse, don't validate |
| 5 | Application: use cases out of `routes.py`; domain errors mapped to HTTP at the edge; `auth` without FastAPI, `sessions` without LangChain | the use case as the unit of behaviour; error translation at the boundary |
| 6 | Agent: an `Agent` port; nodes with explicit dependencies; prompts and classifiers in modules of their own; the graph tested with fakes | LangGraph with dependency injection |
| 7 | Hardening: one pooled HTTP client, a cap on in-flight model calls, a per-turn deadline, limits on the wire, `/ready`, graceful shutdown, a bounded token cache | where an async service actually breaks under load |
| 8 | Observability: JSON logs with request ids, `/metrics`, the Prometheus job, a Grafana dashboard | the three signals; cardinality; what to measure on an LLM service |
| 9 | Load test: locust against a fake model and a real Redis; p50/p95; the pool and the cap tuned on numbers | measure before tuning |
| 10 | Optional: OpenTelemetry traces to Tempo, a span per node and per model call | distributed tracing |

## Landed

| | what |
| --- | --- |
| [#189](https://github.com/vsezol/svinooh/pull/189) | Step 1, the toolchain: a lockfile, three gates, CI, a non-root image |
| [#191](https://github.com/vsezol/svinooh/pull/191) | Step 2, configuration as objects: `Settings`, the `Panel` port, `Config` |
| [#192](https://github.com/vsezol/svinooh/pull/192) | Step 3, the container: built once in `create_app`, handed down through `Depends`; tests build one over fakes |
