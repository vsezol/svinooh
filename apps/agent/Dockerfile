# syntax=docker/dockerfile:1
# Build context is the monorepo ROOT (railway.json sets dockerfilePath; leave
# Root Directory as "/"). A standalone Python service: npm and Nx do not build
# it, and the widget that talks to it is its own deployment (apps/agent-web).
#
# Two stages. The first has uv and installs exactly what uv.lock says; the
# second carries only the interpreter, that venv and the code, and runs as a
# user that owns nothing. What runs in production is what the tests ran on.

FROM python:3.13-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app/apps/agent

FROM base AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
# The image's own interpreter, never a downloaded one; bytecode compiled once
# here rather than on every cold start.
ENV UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
# Dependencies before code, so a code change does not reinstall them: this
# layer is cached until uv.lock moves, which is the caching that matters.
#
# And no `--mount=type=cache` on it, deliberately. Railway's builder only
# accepts one whose id is `s/<service id>-<target>`, and its own docs say a
# variable cannot stand in for that id — so the alternative is this repo
# carrying a platform's opaque service id, to save a package download on the
# rare build where the lockfile changed at all.
#
# The service sits at its repository path so the lockfile's relative path to
# the shared portfolio package resolves; the package is installed as a copy,
# not a link, so the final stage needs only the service's own directory.
COPY libs/portfolio-py /app/libs/portfolio-py
COPY apps/agent/pyproject.toml apps/agent/uv.lock ./
RUN uv sync --frozen --no-dev --no-editable
COPY apps/agent/main.py ./
COPY apps/agent/app ./app

FROM base
RUN useradd --system --uid 10001 --no-create-home agent
COPY --from=builder --chown=agent:agent /app/apps/agent /app/apps/agent
USER agent
ENV PATH="/app/apps/agent/.venv/bin:$PATH"
EXPOSE 3000
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
