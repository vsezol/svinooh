# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/monitor-alerts/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/monitor-alerts/package.json apps/monitor-alerts/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/monitor-alerts -w @svinooh/db -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY libs/common libs/common
COPY apps/monitor-alerts apps/monitor-alerts
RUN npm run -w @svinooh/db build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/monitor-alerts build

FROM node:22-slim
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/monitor-alerts/package.json apps/monitor-alerts/
COPY --from=build /app/apps/monitor-alerts/dist apps/monitor-alerts/dist

EXPOSE 3000
CMD ["node", "-r", "@svinooh/common/dist/tracing", "apps/monitor-alerts/dist/main.js"]
