# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/auth/railway.json, leave Root Directory as "/").

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/auth/package.json apps/auth/
COPY libs/shared/package.json libs/shared/
COPY libs/db/package.json libs/db/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/auth -w @svinooh/db -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/db libs/db
COPY libs/common libs/common
COPY apps/auth apps/auth
# Build shared libs (db: prisma generate + tsc; common: tsc), then the service
RUN npm run -w @svinooh/db build \
  && npm run -w @svinooh/common build \
  && npm run -w apps/auth build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/auth/package.json apps/auth/
COPY --from=build /app/apps/auth/dist apps/auth/dist

EXPOSE 3000
CMD ["node", "apps/auth/dist/main.js"]

# build trigger
