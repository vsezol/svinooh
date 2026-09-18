# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/"). A standalone Python service — npm/Nx don't build it.

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/earn/ ./
RUN pip install --no-cache-dir .

EXPOSE 3000
# Served through earn/api/serve.py rather than the uvicorn CLI: the CLI can
# bind one address family, and this service needs both — Railway's healthcheck
# arrives over IPv4 and its private network resolves only AAAA.
CMD ["python", "-m", "earn.api.serve"]
