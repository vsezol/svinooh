# Build context is the monorepo ROOT (railway.json sets dockerfilePath, leave
# Root Directory as "/").
#
# The agent frontend is its own deployment: its own build, its own domain, its
# own release cadence — the microfrontend cut the design doc describes. The
# agent service beside it is the API and nothing else.

FROM node:22-slim AS build
WORKDIR /build
# Which agent API this build talks to. Inlined at build time (a static bundle
# has no server to read env at runtime); unset, the page falls back to its own
# origin, which is what a local build wants.
ARG AGENT_API_URL
ENV AGENT_API_URL=$AGENT_API_URL
# tsconfig.base.json travels with the manifests: this app's tsconfig extends it
# and esbuild-loader parses that chain.
COPY package.json package-lock.json tsconfig.base.json ./
COPY libs ./libs
COPY apps/agent-web ./apps/agent-web
# npm install, not ci: only a subset of the workspaces is copied in, and ci
# refuses a tree that does not match the whole lockfile.
RUN npm install --no-audit --no-fund --workspace apps/agent-web --workspace libs/ui
RUN npm run -w apps/agent-web build

FROM nginx:1.27-alpine
# The image runs envsubst over anything in templates/ at startup, which is how
# Railway's injected PORT reaches the listen directive.
COPY apps/agent-web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /build/apps/agent-web/dist /usr/share/nginx/html
