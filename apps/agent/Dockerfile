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
WORKDIR /app

FROM base AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
# The image's own interpreter, never a downloaded one; bytecode compiled once
# here rather than on every cold start.
ENV UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
# Dependencies before code, so a code change does not reinstall them.
COPY apps/agent/pyproject.toml apps/agent/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev
COPY apps/agent/main.py ./
COPY apps/agent/app ./app

FROM base
RUN useradd --system --uid 10001 --no-create-home agent
COPY --from=builder --chown=agent:agent /app /app
USER agent
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 3000
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
