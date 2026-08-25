# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/api/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app
# Chrome isn't needed at build time — puppeteer doesn't download it
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
RUN npm ci -w apps/api -w @svinooh/db --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY apps/api apps/api
# Build the shared db package first (prisma generate + tsc), then the api
RUN npm run -w @svinooh/db build \
  && npm run -w apps/api build

FROM node:22-slim
# System chromium for puppeteer: it doesn't download its own Chrome, and
# the container sandbox is disabled via a flag (CHROME_NO_SANDBOX)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PUPPETEER_SKIP_DOWNLOAD=1 \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  CHROME_NO_SANDBOX=1

WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/libs libs
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist

EXPOSE 3000
# Migrations run on start (schema lives in libs/db). npm -w runs from the repo
# root so it resolves the workspace; the DB is only reachable at runtime.
CMD ["sh", "-c", "npm run -w @svinooh/db migrate:deploy && node apps/api/dist/main.js"]
