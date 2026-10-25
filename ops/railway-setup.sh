#!/usr/bin/env bash
#
# svinooh — Railway project as code.
#
# WHY THIS EXISTS
#   The scanner-evm outage happened because a migration (PR #3) made the scan
#   pipeline depend on a `scanner-evm` service that a human had to remember to create —
#   and its variables to wire — by hand. Nothing in the repo said the service
#   had to exist. This script IS that missing source of truth: every service,
#   its source, and its variable wiring, in one reviewable place. Run it against
#   a fresh Railway project (a move, a staging clone, a rebuild) and the stack
#   comes up wired the same way, instead of being re-clicked from memory.
#
# WHAT IT DOES / DOESN'T
#   - Creates every service and sets its source (Docker image or this repo).
#   - Sets every service's variables, including the cross-service references
#     that are the easy thing to forget (REDIS_URL, DATABASE_URL, LOKI_URL, …).
#   - It does NOT set each app's build config (Dockerfile path / config-as-code
#     path). That already lives in the repo, per service, as apps/<svc>/railway.json
#     (and ops/<svc>/railway.json). The Railway CLI can't reliably point a
#     service at its config file, so that stays a one-time manual step, called
#     out under MANUAL STEPS at the bottom. Everything else is scripted.
#   - Secrets are NOT in here. They are read from the environment (see REQUIRED
#     SECRETS) so this file is safe to commit. Fill them before running.
#
#   NOTE: this was written from the live production config but has not been
#   dry-run from empty in this repo — review it, and run it a service at a time
#   the first time. For a fully declarative, plan/apply, CI-testable version,
#   the Railway Terraform provider is the better tool; ask and it can be added
#   as ops/terraform/ alongside this.
#
# PREREQUISITES
#   - Railway CLI v4+  (https://docs.railway.com/guides/cli)
#   - railway login
#   - RAILWAY_PROJECT set to the target project id (or `railway link` first)
#
# REQUIRED SECRETS (export before running — never hard-code)
#   JWT_SECRET               shared by api + auth (must be identical)
#   TELEGRAM_BOT_TOKEN       shared by api + auth
#   TELEGRAM_BOT_USERNAME    the bot's @handle (public, but set explicitly)
#   GRAFANA_ADMIN_PASSWORD   grafana admin login
#   INTERNAL_SECRET          shared by auth + bot-telegram (identical).
#                            It guards the one route that mints a signed-in link
#                            for any Telegram id — auth refuses everything when
#                            it is unset, so this is not optional.
#   PUBLIC_WEB_ORIGIN        e.g. https://svinooh.com
#
set -euo pipefail

REPO="vsezol/svinooh"
BRANCH="main"

: "${JWT_SECRET:?export JWT_SECRET}"
: "${TELEGRAM_BOT_TOKEN:?export TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_BOT_USERNAME:?export TELEGRAM_BOT_USERNAME}"
: "${GRAFANA_ADMIN_PASSWORD:?export GRAFANA_ADMIN_PASSWORD}"
: "${INTERNAL_SECRET:?export INTERNAL_SECRET}"
: "${PUBLIC_WEB_ORIGIN:=https://svinooh.com}"

command -v railway >/dev/null || { echo "railway CLI not found"; exit 1; }

# ── cross-service references ────────────────────────────────────────────────
# Railway resolves ${{service.VAR}} at deploy time over the private network.
# REDIS_URL is the queue (BullMQ, libs/common/src/queue) as well as the
# agent's conversation store: api, scanner-evm and bot-telegram all read it.
PG_URL='${{Postgres.DATABASE_URL}}'
# The api pins its Prisma pool to 10. Prisma's default is CPUs * 2 + 1, and a
# container here sees the host's 48 cores, so an unpinned pool may grow to 97
# connections that are never given back: that is the slow native-memory climb
# the api showed between deploys (set 2026-10-23; watch the RSS slope after).
REDIS_URL='${{Redis.REDIS_URL}}'
# Kept for bringing Loki back; the services below get an empty LOKI_URL today
LOKI_URL='http://${{loki.RAILWAY_PRIVATE_DOMAIN}}:3100'
# Tracing (Tempo + OTEL_EXPORTER_OTLP_ENDPOINT) was removed — it idled at
# ~0.5 GB for traces nobody read. Metrics (Prometheus) stay; logs are read in
# Railway, with Loki asleep (see observability below).

# Every Node service but scanner-evm and web gets these two. A Railway container
# sees all 48 cores of its host, not its 8-vCPU quota, and glibc allows up to
# eight malloc arenas per core it sees. The api's resident memory was ~340MB
# against a 37MB JS heap: the rest is native. The heap cap is more than twice the
# largest heap measured (api, 109MB), so it bounds growth without being a limit
# anyone meets.
NODE_MEMORY=("MALLOC_ARENA_MAX=2" "NODE_OPTIONS=--max-old-space-size=256")
AUTH_URL='http://${{auth.RAILWAY_PRIVATE_DOMAIN}}:3000'
API_PUBLIC='https://${{api.RAILWAY_PUBLIC_DOMAIN}}'

# ── helpers ─────────────────────────────────────────────────────────────────
# Create a service if it isn't there yet. `railway add` is idempotent enough for
# a fresh project; on an existing one, skip names that already exist.
add_image()   { railway add --service "$1" --image "$2"; }             # $1 name  $2 image
add_repo()    { railway add --service "$1" --repo "$REPO"; }           # $1 name  (branch = default)
add_db()      { railway add --database "$1"; }                          # $1 postgres|redis
setvars()     { local s="$1"; shift; local a=(); for kv in "$@"; do a+=(--set "$kv"); done
                railway variables --service "$s" "${a[@]}"; }

echo "== databases (Railway plugins: managed image + volume) =="
add_db postgres
add_db redis

echo "== observability =="
# Go sizes its runtime from the cores it sees (GOMAXPROCS was 48 on both Loki and
# Prometheus), so each Go service gets GOMAXPROCS and a soft memory ceiling.
#
# Loki is kept but asleep (Serverless, see MANUAL STEPS). Nothing ships logs to
# it — LOKI_URL is empty on the services below — and Prometheus does not scrape
# it: it was holding ~190MB to ingest about five lines a minute. To bring it
# back, set LOKI_URL=${LOKI_URL} on api and auth and restore the loki job
# in ops/prometheus/prometheus.yml; the first push wakes it.
add_image loki "grafana/loki:3.1.1"              # config from image; volume /loki
setvars loki   "RAILWAY_RUN_UID=0" "GOMAXPROCS=2" "GOMEMLIMIT=150MiB"
add_repo prometheus                               # config: ops/prometheus/railway.json ; volume /prometheus
setvars prometheus "RAILWAY_RUN_UID=0" "GOMAXPROCS=2" "GOMEMLIMIT=100MiB"
add_repo grafana                                  # config: ops/grafana/railway.json ; volume /var/lib/grafana ; PUBLIC
setvars grafana \
  "RAILWAY_RUN_UID=0" \
  "GOMAXPROCS=2" "GOMEMLIMIT=150MiB" \
  "GF_ANALYTICS_REPORTING_ENABLED=false" \
  "GF_ANALYTICS_CHECK_FOR_UPDATES=false" \
  "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false" \
  "GF_SECURITY_ADMIN_USER=admin" \
  "GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}" \
  "GF_USERS_ALLOW_SIGN_UP=false" \
  'GF_SERVER_ROOT_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}'

echo "== application services (all from ${REPO}@${BRANCH}) =="

# api — public HTTP gateway. Dockerfile apps/api/Dockerfile ; healthcheck /api/health
#
# The tunables behind the Admin tab are served from here, by a module fenced off
# inside the app (apps/api/src/admin). They were their own service until the
# hop and the shared secret stopped paying for themselves; the guard that reads
# isAdmin from the database on every request is unchanged, so nothing has to be
# wired for it — no variable, no service, no private URL.
#
# Who is an admin is a column on User, set in the database and nowhere else.
# Nothing in the product grants it, so there is no flow to get wrong.
#
# The scan pipeline is in here too (apps/api/src/wallet), for the same reason:
# it was a service with the same database, the same broker and one HTTP route
# the api called to say "scan this now". It decides what is due, drains
# scan.sol/tron/btc in this process, and is the single writer of scan.result —
# so this service must NOT be scaled past one replica. Two of it would mean two
# producers and two writers of the same readings.
#
# It needs ≥ 512MB on top of what the gateway itself uses; the scanners are
# HTTP-bound, not CPU-bound (the browser one is scanner-evm, still separate).
#
# Deciding who to alert is in here too (apps/api/src/alerts). It was
# monitor-alerts, a service whose whole input was a queue this one published
# to and nothing else read. It still publishes alerts.telegram,
# notices.telegram and billing.telegram — the bot is a real service on the
# other side of those — and it still sweeps every 15 minutes for portfolios
# that have gone quiet and subscriptions about to lapse.
add_repo api
setvars api \
  "NODE_ENV=production" "PORT=3000" \
  "DATABASE_URL=${PG_URL}?connection_limit=10" "REDIS_URL=${REDIS_URL}" \
  "JWT_SECRET=${JWT_SECRET}" \
  "AUTH_SERVICE_URL=${AUTH_URL}" \
  "WEB_ORIGIN=${PUBLIC_WEB_ORIGIN}" \
  "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" "TELEGRAM_BOT_USERNAME=${TELEGRAM_BOT_USERNAME}" \
  "SYNC_INTERVAL_MIN=5" \
  "LOKI_URL=" "${NODE_MEMORY[@]}" \
  "SERVICE_NAME=svinooh-api"

# auth — Telegram sign-in, JWT issuer. config apps/auth/railway.json
add_repo auth
setvars auth \
  "PORT=3000" "AUTH_DEV_MODE=false" \
  "DATABASE_URL=${PG_URL}" \
  "JWT_SECRET=${JWT_SECRET}" \
  "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" "TELEGRAM_BOT_USERNAME=${TELEGRAM_BOT_USERNAME}" \
  "WEB_URL=${PUBLIC_WEB_ORIGIN}" \
  "INTERNAL_SECRET=${INTERNAL_SECRET}" \
  "LOKI_URL=" "${NODE_MEMORY[@]}" \
  "SERVICE_NAME=svinooh-auth"

# scanner-evm — the EVM browser scanner. THE service whose absence caused the
# outage: it declares and drains scan.evm and publishes scan.result.
# Give it ≥ 1GB if SCANNER_ENGINE=chrome; ~512MB is enough for lightpanda.
# config apps/scanner-evm/railway.json (downloads the lightpanda binary at build)
#
# It also takes ZERION_API_KEY when scan.evmSource is set to `zerion` in the
# admin panel. It is a secret, so it lives in this service's variables rather
# than in the registry — that file is public and the panel shows every value
# in it.
add_repo scanner-evm
setvars scanner-evm \
  "PORT=3000" \
  "REDIS_URL=${REDIS_URL}" \
  "SCANNER_ENGINE=lightpanda" \
  "CHROME_NO_SANDBOX=1" \
  "LOKI_URL=" \
  "SERVICE_NAME=svinooh-scanner-evm"

# bot-telegram — the Telegram bot: long-polls for /start, and drains
# alerts.telegram. It must run as EXACTLY ONE replica — Telegram allows a single
# long-poll consumer per bot token, and two would fight over updates.
# It has no database: it asks auth for a sign-in link over the private network,
# which is what INTERNAL_SECRET protects. config apps/bot-telegram/railway.json
add_repo bot-telegram
setvars bot-telegram \
  "NODE_ENV=production" "PORT=3000" \
  "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" \
  "INTERNAL_SECRET=${INTERNAL_SECRET}" \
  "AUTH_URL=${AUTH_URL}" \
  "WEB_URL=${PUBLIC_WEB_ORIGIN}" \
  "REDIS_URL=${REDIS_URL}" \
  "${NODE_MEMORY[@]}"

# web — Next.js. PUBLIC (svinooh.com). Dockerfile apps/web/Dockerfile ; port 4173
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at BUILD time — a
# change needs a rebuild, not just a restart.
add_repo web
setvars web \
  "NODE_ENV=production" "PORT=4173" \
  "NEXT_PUBLIC_API_URL=${API_PUBLIC}" "VITE_API_URL=${API_PUBLIC}"

cat <<'MANUAL'

========================= MANUAL STEPS (one-time, per service) =========================
The Railway CLI does not set these reliably; do them once in the dashboard
(Service → Settings), then every future deploy is fully hands-off.

1. Config-as-code path — point each repo service at its committed config so its
   Dockerfile/healthcheck/volume come from the repo, not guesswork:
     api          → apps/api/railway.json          (or set Dockerfile path apps/api/Dockerfile)
     auth         → apps/auth/railway.json
     scanner-evm  → apps/scanner-evm/railway.json
     bot-telegram → apps/bot-telegram/railway.json
     web          → apps/web/railway.json          (or Dockerfile path apps/web/Dockerfile)
     prometheus   → ops/prometheus/railway.json
     grafana      → ops/grafana/railway.json
   Root Directory stays "/" for all of them (the Docker build context is the
   monorepo root; the Dockerfile path is relative to it).

2. Volumes — attach a volume to each stateful service at the mount path it
   expects (data lives here; size to taste):
     Postgres → its plugin volume     Redis → its plugin volume
     loki → /loki
     prometheus → /prometheus          grafana → /var/lib/grafana
   Every service with a volume also needs RAILWAY_RUN_UID=0 (already set above),
   because Railway mounts volumes as root while the images run non-root.

3. Public domains — expose only what should be public:
     web  → svinooh.com + www.svinooh.com (port 4173)
     api  → its railway.app domain (port 3000)   grafana → its railway.app domain
   Everything else stays private-network only.

4. Migrations — the api runs `prisma migrate deploy` on boot; it is the only
   service that writes the schema. Nothing else needs DB migration rights.

5. Replicas — bot-telegram must stay at ONE. Telegram allows a single long-poll
   consumer per bot token; a second replica would take half the updates and
   answer nobody consistently.

6. Serverless (Service → Settings → Deploy → Serverless) — a sleeping service
   costs nothing. The setting takes effect on the service's next deploy.
     loki   → nothing ships logs to it or scrapes it (see observability)
     grafana → nobody looks at it most of the day; it wakes on the first
              request, a few seconds. A dashboard tab left open with
              auto-refresh is traffic and keeps it awake (set 2026-10-23)
   Nothing holding a queue connection, polling settings or scraped by
   Prometheus can sleep: that traffic keeps a service awake by design.
========================================================================================
MANUAL
echo "done — review the MANUAL STEPS above."
