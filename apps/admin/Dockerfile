# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/admin/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/admin/package.json apps/admin/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/admin -w @svinooh/db -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY libs/common libs/common
COPY apps/admin apps/admin
# Build shared libs (db: prisma generate + tsc; common: tsc), then the service
RUN npm run -w @svinooh/db build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/admin build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/admin/package.json apps/admin/
COPY --from=build /app/apps/admin/dist apps/admin/dist

EXPOSE 3000
# `-r @svinooh/common/dist/tracing` starts OpenTelemetry BEFORE the app: the
# instrumentation patches modules as they are required, so anything already
# loaded would never be traced. With OTEL_EXPORTER_OTLP_ENDPOINT unset it is a
# no-op.
CMD ["node", "-r", "@svinooh/common/dist/tracing", "apps/admin/dist/main.js"]

# build trigger
