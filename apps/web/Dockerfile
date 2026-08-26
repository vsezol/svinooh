# Build context — the ROOT of the monorepo (Railway: dockerfilePath is set in
# apps/web/railway.json, leave Root Directory as "/").
#
# VITE_API_URL is baked into the static assets at build time: on Railway it is
# enough to define the VITE_API_URL variable on the web service (the public api URL),
# and Railway will pass it into the docker build as an ARG. The same value is
# read again at runtime, where the server uses it to fetch the landing it
# renders — API_INTERNAL_URL overrides it with the private address.

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
WORKDIR /app
ENV NODE_ENV=production
# VITE_API_URL is a service variable, so it is in the environment at runtime
# too — nothing to copy across the stage boundary here.
# Two files and no dependency tree: the SSR bundle carries React with it, and
# the server itself is plain Node.
COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/apps/web/server.mjs ./server.mjs
ENV PORT=4173
EXPOSE 4173
CMD ["node", "server.mjs"]
