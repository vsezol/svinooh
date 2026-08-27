# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/scanner-evm/railway.json, leave Root Directory as "/").
#
# This is the only image in the project that carries a browser. It was split out
# of the wallet service for exactly that reason: Chromium is heavy, stateful and
# the thing that breaks, and the chains that need one HTTP request should not
# share a process — or a restart — with it.

FROM node:22-slim AS build
WORKDIR /app
# Chrome isn't needed at build time — puppeteer doesn't download it
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/scanner-evm/package.json apps/scanner-evm/
COPY libs/shared/package.json libs/shared/
COPY libs/common/package.json libs/common/
RUN npm ci -w apps/scanner-evm -w @svinooh/common --no-audit --no-fund

COPY libs/shared libs/shared
COPY libs/common libs/common
COPY apps/scanner-evm apps/scanner-evm
RUN npm run -w @svinooh/common build \
  && npm run -w apps/scanner-evm build

FROM node:22-slim
# Two browser engines behind SCANNER_ENGINE:
#  - lightpanda (default): a ~76 MB Zig headless browser, downloaded below.
#  - chromium (fallback): system package; its sandbox is disabled via a flag
#    (CHROME_NO_SANDBOX) because a container has no user namespaces to sandbox with.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# lightpanda binary for the build platform. Pinned to the version the engine was
# benchmarked and verified against; bump deliberately. TARGETARCH is provided by
# BuildKit (amd64 / arm64).
ARG TARGETARCH=amd64
ARG LIGHTPANDA_VERSION=0.3.7
RUN case "$TARGETARCH" in \
      amd64) LP_ARCH=x86_64 ;; \
      arm64) LP_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL -o /usr/local/bin/lightpanda \
       "https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/lightpanda-${LP_ARCH}-linux" \
  && chmod +x /usr/local/bin/lightpanda \
  && /usr/local/bin/lightpanda version

ENV NODE_ENV=production \
  PUPPETEER_SKIP_DOWNLOAD=1 \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  CHROME_NO_SANDBOX=1 \
  SCANNER_ENGINE=lightpanda

WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/libs libs
COPY --from=build /app/apps/scanner-evm/package.json apps/scanner-evm/
COPY --from=build /app/apps/scanner-evm/dist apps/scanner-evm/dist

EXPOSE 3000
# `-r @svinooh/common/dist/tracing` starts OpenTelemetry BEFORE the app: the
# instrumentation patches modules as they are required, so anything already
# loaded would never be traced. With OTEL_EXPORTER_OTLP_ENDPOINT unset it is a
# no-op.
CMD ["node", "-r", "@svinooh/common/dist/tracing", "apps/scanner-evm/dist/main.js"]
