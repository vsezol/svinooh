# Build context — the ROOT of the monorepo (Railway: dockerfilePath is set in
# apps/web/railway.json, leave Root Directory as "/").
#
# VITE_API_URL is baked into the static assets at build time: on Railway it is
# enough to define the VITE_API_URL variable on the web service (the public api URL),
# and Railway will pass it into the docker build as an ARG.

FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY libs/shared/package.json libs/shared/
RUN npm ci -w apps/web --no-audit --no-fund

COPY libs/shared libs/shared
COPY apps/web apps/web
RUN npm run -w apps/web build

FROM node:22-alpine
RUN npm i -g serve@14
COPY --from=build /app/apps/web/dist /app/dist
ENV PORT=4173
EXPOSE 4173
# -s: SPA fallback to index.html for routes like /p/:slug
CMD ["sh", "-c", "serve -s /app/dist -l tcp://0.0.0.0:${PORT}"]
