# Build context — the ROOT of the monorepo (Railway: dockerfilePath is set in
# apps/web/railway.json, leave Root Directory as "/").
#
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time, so
# Railway passes the service variable in as an ARG. The server reads it again at
# runtime to render the landing.

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

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
ENV PORT=4173
ENV HOSTNAME=0.0.0.0
# Next's standalone output: the server plus only the dependencies it actually
# traced, so there is no node_modules tree to copy. It does not carry the built
# assets or public/ though — both have to come across by hand, and a missing
# public/ is silent: every icon and the service worker simply 404.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 4173
CMD ["node", "apps/web/server.js"]
