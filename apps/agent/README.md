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
