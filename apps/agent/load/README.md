# Load test

The numbers in `app/settings.py` used to be guesses made from the shape of the
thing. This is how they stopped being guesses, and how to re-take them when
something changes.

## What it measures, and what it deliberately does not

Pointed at the real OpenRouter, a run measures OpenRouter — its queueing, its
rate limits, its weather that afternoon. So `fake_upstream.py` answers both
upstreams on one port, in the shape the real ones use: the OpenAI wire with
tool calls and streaming, and the host API with a portfolio worth parsing.
Every delay is a knob, which is what makes two runs comparable.

What is left being measured is ours: how long a turn waits in our own
semaphore, whether the connection pool holds, what our p95 is when the model
is boringly constant.

## Running it

Three terminals, or three background processes. A real Redis is wanted — the
store and the counters are what the run is partly about — and its own database
so the numbers do not land beside anything else.

```bash
# 1. the fake model and the fake host API
uv run python load/fake_upstream.py

# 2. the service, pointed at both
env AGENT_MODEL=openai:fake AGENT_MODEL_BASE_URL=http://127.0.0.1:9099/v1 \
    AGENT_MODEL_API_KEY=not-a-real-key PORTFOLIO_API_URL=http://127.0.0.1:9099 \
    REDIS_URL=redis://localhost:6379/1 \
    AGENT_RATE_LIMIT_REQUESTS=1000000 AGENT_FREE_QUESTIONS=1000000 \
    uv run uvicorn main:app --port 9098 --log-level warning

# 3. the readers
uv run locust -f load/locustfile.py --host http://127.0.0.1:9098 \
    --headless -u 50 -r 25 -t 60s
```

**The two limits have to be lifted for a run, and that is not a workaround.**
The cost lock charges every anonymous caller to one shared bucket by design,
and the free allowance is five questions a day per browser id. Both would
refuse a load test within seconds, which is exactly what they are for.

`curl localhost:9098/metrics` during a run answers the question the summary
cannot: `svinooh_agent_model_calls_in_flight` says whether the semaphore is
the thing holding everybody up.

## What it found, 2026-09-10

Fifty readers for sixty seconds, a fake model answering in 300 ms, a portfolio
of 60 positions and 300 history points. A general turn is two model calls, a
grounded one is three plus a fetch and a tool hop.

**Unloaded, five readers** — the baseline the service cannot beat, because it
is mostly the model:

| | p50 | our share of it |
| --- | --- | --- |
| `/chat` general | 614 ms | ~14 ms |
| `/chat` grounded | 1015 ms | ~75 ms |
| `/chat/stream` first event | 3 ms | all of it |

Seventy-five milliseconds is the whole grounded turn's own work: parsing 60
positions into the domain, rendering the context block, parsing 300 history
points and computing the change. That is the answer to "is the mapper from
step 4 expensive" — it is not.

**Fifty readers, the shipped cap of 8 in flight:**

| | p50 | p95 |
| --- | --- | --- |
| `/chat` general | 2800 ms | 3100 ms |
| `/chat` grounded | 4300 ms | 4700 ms |
| aggregate | 15 req/s | |

`model_calls_in_flight` sat at exactly 8 for the whole run. Every turn was
queueing behind our own valve, four times slower than it needed to be, and
zero requests failed — the queue holds rather than dropping, which is the
right behaviour applied to the wrong number.

**The same run at 32, and at 64:**

| | 8 | 32 | 64 |
| --- | --- | --- | --- |
| turns in 60 s | 664 | 1408 | 1386 |
| aggregate | 15 req/s | 35 req/s | 35 req/s |
| general p50 | 2800 ms | 620 ms | 620 ms |
| grounded p50 | 4300 ms | 1000 ms | 1000 ms |
| in flight | 8, pegged | 19 | 14 |
| failures | 0 | 0 | 0 |

32 and 64 are the same service; the difference is entirely that 8 was below
the concurrency of ordinary traffic rather than above it. **The default moved
to 32**: it has headroom over this profile, and it still bounds a burst. The
rate limit is the cost lock; a valve that closes under normal load is just a
slower service.

Nothing else moved. No turn came within an order of magnitude of the 120-second
deadline, the connection pool was never near its 100, and `svinooh_errors_total`
stayed empty in every run.

## When to take them again

When the model changes tier, when a branch grows another model call, or when
the graph grows a node that does real work. The instruments are already
there — this only points readers at them.
