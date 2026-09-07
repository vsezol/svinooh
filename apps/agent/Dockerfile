# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/").
#
# Two stages: node builds the agent frontend (apps/agent-web, a workspace
# member sharing the UI kit in libs/ui), python serves the service — and that
# build under /widget. Riding in the agent's image is a serving decision, not
# a coupling one (see DESIGN.md M3a): one origin for the service and its
# frontend means no extra Railway service to pay for, and the bundle redeploys
# with the wire contract it speaks.

FROM node:22-slim AS widget
WORKDIR /build
COPY package.json package-lock.json ./
COPY libs ./libs
COPY apps/agent-web ./apps/agent-web
# npm install, not ci: only a subset of the workspaces is copied in, and ci
# refuses a tree that does not match the whole lockfile.
RUN npm install --no-audit --no-fund --workspace apps/agent-web --workspace libs/ui
RUN npm run -w apps/agent-web build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/agent/ ./
COPY --from=widget /build/apps/agent-web/dist ./widget

EXPOSE 3000
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
