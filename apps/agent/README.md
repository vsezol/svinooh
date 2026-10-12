# svinooh agent

The assistant behind `/ai`: FastAPI in front, a LangGraph graph behind, and
the portfolio read over its public API with the caller's own token. The
architecture is in [DESIGN.md](DESIGN.md); the order in which the code is
being brought to production shape is in [ROADMAP.md](ROADMAP.md).

## Run it

Needs [uv](https://docs.astral.sh/uv/). Redis is optional: without
`REDIS_URL`, conversations and counters live in the process.

```bash
uv sync                                     # the venv, exactly what uv.lock says
cp .env.example .env                        # then fill in AGENT_MODEL_API_KEY
uv run --env-file .env uvicorn main:app --reload --port 3000
```

## Is it reaching anything

`/health` says the process is up — it is what the platform restarts on.
`/ready` says what this instance can actually reach, and answers 503 when a
Redis is configured and not answering, which is the failure that otherwise
looks like nothing at all:

```bash
curl -s localhost:3000/ready
```

## What it says while it runs

Every line is one JSON object carrying the id of the request that produced
it, so one turn can be read back out of a busy log:

```bash
railway logs --service agent | jq -c 'select(.request_id == "…")'
```

`/metrics` is the Prometheus scrape, named to match the rest of the product:
the HTTP series are the same ones the api and the wallet emit, and the
agent's own are underneath — `svinooh_agent_turns_total`,
`svinooh_agent_model_duration_seconds`, `svinooh_agent_tool_calls_total`.

## What it traces

With `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` set, every turn is one
Langfuse trace: the nodes of the graph, every model call with its tokens and
every tool with its arguments. The chat is the session and the owner is the
user. A bearer token is cut out of every span before it leaves the process.
The SDK reads the rest of its settings from `LANGFUSE_*` variables itself.

## Measure it

`evals/` holds the golden set: turns the agent must keep getting right, each
played in a recorded world, so a run measures the model and the prompts and
nothing else. A world (`evals/worlds/*.json`) is every answer the host API and
the earn catalog gave, read through the agent's real adapters. A case
(`evals/golden.yaml`) is one turn and what must come of it: the branch that
answers, the tools it calls, the cards it prepares, and what the answer must
say and must never say. Every case is in English and is also held to four
rules nobody writes down: no write to the host unless the case expects one, an
answer in English, no emoji, no quoting its own prompt.

```bash
uv run --env-file .env python -m evals.run                      # one pass, a scorecard
uv run --env-file .env python -m evals.run --repeat 3 --gate    # what the workflow runs
uv run --env-file .env python -m evals.run --model openai:...   # another model, same set
```

With the Langfuse keys set, the cases are synced to the `agent-golden` dataset
and every pass is an experiment there, with a score per check per turn and the
pass rate, p95 latency and cost per turn on the run.

`--gate` fails on a guardrail case that broke even once, a case the approved
baseline passed that now fails in most passes, and a turn that never finished.
`--approve` writes `evals/baseline.json` from a run; it goes in through review
like code.

Both runs cost money, so neither starts on a push. Start one by hand on the
branch to measure, from Actions -> `agent evals` (or `agent judges`) -> Run
workflow, or:

```bash
gh workflow run agent-evals.yml --ref my-branch           # three passes and the judges, about $0.20
gh workflow run agent-judges.yml --ref my-branch          # calibration, about $0.02
```

Run the golden set before merging a change to the prompts, the graph or the
model, and the calibration after a change to the judges or their labels.

Three things code cannot read are read by a cheap model of another family,
`anthropic/claude-haiku-5.5` unless `--judge` names another: whether every
figure in the answer is in the data the agent was given (`grounded`), whether
it does what was asked (`answers_the_question`), and whether it tells the
truth about what happened (`honest_about_actions`). A judge answers pass, fail
or unknown, reasoning first, on the first pass of a run.

A judge is trusted only once it agrees with labelled replies. `evals/labels.yaml`
holds eight passes and eight failures for each, and

```bash
uv run --env-file .env python -m evals.calibrate
```

reports how many failures each judge catches, how many passes it clears, and
Cohen's kappa. Until a judge catches and clears 90%, its verdicts are reported
on the golden run and do not gate it.

## Push on it

`load/` holds a fake model, a fake host API and a locustfile, so a run
measures this service rather than the provider's afternoon. The numbers it
last produced, and the setting they moved, are in
[load/README.md](load/README.md).

## Check it

The gates CI runs on every PR that touches `apps/agent`:

```bash
uv run ruff check && uv run ruff format --check
uv run mypy
uv run pytest
```

The Redis-backed store tests skip unless a Redis is reachable:

```bash
AGENT_TEST_REDIS_URL=redis://localhost:6379/0 uv run pytest tests/test_store_redis.py
```

Contract tests against the live API are opt-in: `uv run pytest -m contract`.
