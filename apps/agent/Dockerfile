# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/"). A standalone Python service — npm/Nx don't build it.
#
# The API and nothing else: the frontend that talks to it is its own
# deployment (apps/agent-web), which is why no node stage rides along here.

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/agent/ ./

EXPOSE 3000
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
