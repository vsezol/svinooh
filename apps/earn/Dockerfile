# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/"). A standalone Python service — npm/Nx don't build it.

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/earn/ ./
RUN pip install --no-cache-dir .

EXPOSE 3000
# Through serve.py, not the uvicorn CLI: the CLI binds one address family.
CMD ["python", "-m", "earn.api.serve"]
