# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/earn/package.json apps/earn/
RUN npm ci -w apps/earn --no-audit --no-fund

COPY apps/earn apps/earn
RUN npm run -w apps/earn build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/earn/package.json apps/earn/
COPY --from=build /app/apps/earn/dist apps/earn/dist

EXPOSE 3000
# Listening on `::` and not 0.0.0.0: Railway's private network resolves only
# AAAA and its healthcheck arrives over IPv4, and one dual-stack socket is the
# only thing that answers both (src/main.ts).
CMD ["node", "apps/earn/dist/main.js"]
