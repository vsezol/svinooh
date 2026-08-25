# Build context — the ROOT of the monorepo (Railway: dockerfilePath is set in
# apps/api/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app
# Chrome is not needed during the build stage — puppeteer does not download it
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY libs/shared/package.json libs/shared/
RUN npm ci -w apps/api --no-audit --no-fund

COPY libs/shared libs/shared
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run -w apps/api build

FROM node:22-slim
# System chromium for puppeteer: it does not download its own Chrome, and
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
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
EXPOSE 3000
# Migrations are applied on startup — the DB is available only at runtime
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
