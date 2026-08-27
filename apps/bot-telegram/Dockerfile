# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/bot-telegram/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/bot-telegram/package.json apps/bot-telegram/
COPY libs/shared/package.json libs/shared/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/bot-telegram -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/common libs/common
COPY apps/bot-telegram apps/bot-telegram
RUN npm run build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/bot-telegram build

FROM node:22-slim
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/bot-telegram/package.json apps/bot-telegram/
COPY --from=build /app/apps/bot-telegram/dist apps/bot-telegram/dist

EXPOSE 3000
CMD ["node", "-r", "@svinooh/common/dist/tracing", "apps/bot-telegram/dist/main.js"]
