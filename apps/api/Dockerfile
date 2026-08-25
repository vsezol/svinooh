# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/api/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/api -w @svinooh/db -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY libs/common libs/common
COPY apps/api apps/api
# Build the shared libs first (db: prisma generate + tsc; common: tsc), then the api
RUN npm run -w @svinooh/db build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/api build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist

EXPOSE 3000
# Migrations run on start (schema lives in libs/db). The DB is only reachable
# at runtime, so this can't happen at build time.
# `-r @svinooh/common/dist/tracing` starts OpenTelemetry BEFORE the app: the
# instrumentation patches modules as they are required, so anything already
# loaded would never be traced. With OTEL_EXPORTER_OTLP_ENDPOINT unset it is a
# no-op.
CMD ["sh", "-c", "npx prisma migrate deploy --schema libs/db/prisma/schema.prisma && node -r @svinooh/common/dist/tracing apps/api/dist/main.js"]
