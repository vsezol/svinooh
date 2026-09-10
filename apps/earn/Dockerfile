# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/"). A standalone Python service — npm/Nx don't build it.

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/earn/ ./
RUN pip install --no-cache-dir .

EXPOSE 3000
# `--factory` because the application is built by a function that takes its
# dependencies (earn/api/app.py), not assembled at import time by a module.
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn earn.api.app:create_app --factory --host 0.0.0.0 --port ${PORT:-3000}"]
