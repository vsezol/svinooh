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
# The PostHog project key — public by design (it can only write events), but
# inlined at build time like every NEXT_PUBLIC_ variable. Absent, the build is
# simply a build without analytics.
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
# Where the agent deployment lives. Inlined at build time like the others;
# absent, the AI tab simply has nothing to load.
ARG NEXT_PUBLIC_AGENT_URL
ENV NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL
ARG NEXT_PUBLIC_AGENT_WIDGET_URL
ENV NEXT_PUBLIC_AGENT_WIDGET_URL=$NEXT_PUBLIC_AGENT_WIDGET_URL

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY libs/shared/package.json libs/shared/
COPY libs/content/package.json libs/content/
COPY libs/ui/package.json libs/ui/
RUN npm ci -w apps/web -w @svinooh/content --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/content libs/content
# The design system the app is built from (@svinooh/ui, transpiled by Next):
# a workspace dependency, so its source has to be in the image like any other
# part of the app.
COPY libs/ui libs/ui
COPY apps/web apps/web
# What the product says about itself, compiled: the FAQ page reads it, and
# so does the api, so it ships as a built package rather than as source Next
# happens to transpile.
RUN npm run -w @svinooh/content build \
  && npm run -w apps/web build

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
