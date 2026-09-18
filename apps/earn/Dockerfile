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
#
# `--host ::` and not 0.0.0.0, which is the difference between a service that
# answers and one that cannot be reached at all: this service has no public
# domain on purpose — the agent calls it at earn.railway.internal — and
# Railway's private network resolves only AAAA. A socket bound to 0.0.0.0 is
# listening on IPv4, where nothing is calling. Dual-stack is the default for
# `::`, so a public domain later would still work.
#
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn earn.api.app:create_app --factory --host :: --port ${PORT:-3000}"]
