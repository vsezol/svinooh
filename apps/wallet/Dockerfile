# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/wallet/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app
# Chrome isn't needed at build time — puppeteer doesn't download it
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/wallet/package.json apps/wallet/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/wallet -w @svinooh/db -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY libs/common libs/common
COPY apps/wallet apps/wallet
# Build shared libs (db: prisma generate + tsc; common: tsc), then the service
RUN npm run -w @svinooh/db build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/wallet build

FROM node:22-slim
# System chromium for puppeteer (EVM Chrome fallback); the container sandbox is
# disabled via a flag (CHROME_NO_SANDBOX)
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
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/wallet/package.json apps/wallet/
COPY --from=build /app/apps/wallet/dist apps/wallet/dist

EXPOSE 3000
CMD ["node", "apps/wallet/dist/main.js"]

# build trigger
