# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/").
#
# Two stages: node builds the embeddable widget (apps/agent-widget) into one
# file, python serves the service — and that one file at /widget/. The widget
# is its own application in the repo with its own build; riding in the agent's
# image is a serving decision, not a coupling one (see DESIGN.md M3a): one
# origin for the service and its widget means no extra Railway service to pay
# for, and the bundle redeploys with the wire contract it speaks.

FROM node:22-slim AS widget
WORKDIR /build
COPY apps/agent-widget/package.json apps/agent-widget/tsconfig.json ./
COPY apps/agent-widget/src ./src
RUN npm install --no-audit --no-fund && npm run build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY apps/agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/agent/ ./
COPY --from=widget /build/dist/agent-widget.js ./widget/agent-widget.js

EXPOSE 3000
# Railway injects PORT; default 3000 to match the other services.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
