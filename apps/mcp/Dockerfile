# syntax=docker/dockerfile:1
# Build context is the monorepo ROOT (railway.json sets dockerfilePath; leave
# Root Directory as "/"). Built the way apps/agent is: uv installs exactly what
# uv.lock says in the first stage, the second carries the interpreter, that
# venv and the code, and runs as a user that owns nothing.

FROM python:3.13-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app/apps/mcp

FROM base AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
# The service sits at its repository path so the lockfile's relative path to
# the shared portfolio package resolves; the package is installed as a copy,
# not a link, so the final stage needs only the service's own directory.
COPY libs/portfolio-py /app/libs/portfolio-py
COPY apps/mcp/pyproject.toml apps/mcp/uv.lock ./
RUN uv sync --frozen --no-dev --no-editable
COPY apps/mcp/main.py ./
COPY apps/mcp/app ./app

FROM base
RUN useradd --system --uid 10001 --no-create-home mcp
COPY --from=builder --chown=mcp:mcp /app/apps/mcp /app/apps/mcp
USER mcp
ENV PATH="/app/apps/mcp/.venv/bin:$PATH"
# 3000 is the public domain's; 3001, for the agent, is reached only privately
EXPOSE 3000
CMD ["python", "main.py"]
