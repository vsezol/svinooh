#!/usr/bin/env bash
#
# svinooh — Railway project as code.
#
# WHY THIS EXISTS
#   The scanner-evm outage happened because a migration (PR #3) made `wallet`
#   depend on a `scanner-evm` service that a human had to remember to create —
#   and its variables to wire — by hand. Nothing in the repo said the service
#   had to exist. This script IS that missing source of truth: every service,
#   its source, and its variable wiring, in one reviewable place. Run it against
#   a fresh Railway project (a move, a staging clone, a rebuild) and the stack
#   comes up wired the same way, instead of being re-clicked from memory.
#
# WHAT IT DOES / DOESN'T
#   - Creates every service and sets its source (Docker image or this repo).
#   - Sets every service's variables, including the cross-service references
#     that are the easy thing to forget (RABBITMQ_URL, DATABASE_URL, LOKI_URL, …).
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
#   INTERNAL_SECRET          shared by auth, bot-telegram, api + admin (identical).
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
: "${ANTHROPIC_API_KEY:?export ANTHROPIC_API_KEY}"   # the AI agent's key
: "${PUBLIC_WEB_ORIGIN:=https://svinooh.com}"

command -v railway >/dev/null || { echo "railway CLI not found"; exit 1; }

# ── cross-service references ────────────────────────────────────────────────
# Railway resolves ${{service.VAR}} at deploy time over the private network.
# RABBITMQ_URL is assembled from the broker's own building blocks — the broker
# image exposes USER/PASS + a private domain, not a ready URL. This exact form
# is what the live services use (verified: scanner-evm connected with it).
PG_URL='${{Postgres.DATABASE_URL}}'
REDIS_URL='${{Redis.REDIS_URL}}'
RABBIT_URL='amqp://${{rabbitmq.RABBITMQ_DEFAULT_USER}}:${{rabbitmq.RABBITMQ_DEFAULT_PASS}}@${{rabbitmq.RAILWAY_PRIVATE_DOMAIN}}:5672'
LOKI_URL='http://${{loki.RAILWAY_PRIVATE_DOMAIN}}:3100'
# Tracing (Tempo + OTEL_EXPORTER_OTLP_ENDPOINT) was removed — it idled at
# ~0.5 GB for traces nobody read. Logs (Loki) and metrics (Prometheus) stay.
AUTH_URL='http://${{auth.RAILWAY_PRIVATE_DOMAIN}}:3000'
ADMIN_URL='http://${{admin.RAILWAY_PRIVATE_DOMAIN}}:3000'
WALLET_URL='http://${{wallet.RAILWAY_PRIVATE_DOMAIN}}:3000'
AGENT_URL='http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:3000'
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

echo "== message broker =="
add_image rabbitmq "rabbitmq:3.13-management"
# RABBITMQ_DEFAULT_USER/PASS are generated by the plugin template; if you create
# it bare, set them here and they flow into RABBIT_URL via the references above.

echo "== observability =="
add_image loki "grafana/loki:3.1.1"              # config from image; volume /loki
setvars loki   "RAILWAY_RUN_UID=0"
add_repo prometheus                               # config: ops/prometheus/railway.json ; volume /prometheus
setvars prometheus "RAILWAY_RUN_UID=0"
add_repo grafana                                  # config: ops/grafana/railway.json ; volume /var/lib/grafana ; PUBLIC
setvars grafana \
  "RAILWAY_RUN_UID=0" \
  "GF_SECURITY_ADMIN_USER=admin" \
  "GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}" \
  "GF_USERS_ALLOW_SIGN_UP=false" \
  'GF_SERVER_ROOT_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}'

echo "== application services (all from ${REPO}@${BRANCH}) =="

# api — public HTTP gateway. Dockerfile apps/api/Dockerfile ; healthcheck /api/health
add_repo api
setvars api \
  "NODE_ENV=production" "PORT=3000" \
  "DATABASE_URL=${PG_URL}" "REDIS_URL=${REDIS_URL}" \
  "JWT_SECRET=${JWT_SECRET}" \
  "AUTH_SERVICE_URL=${AUTH_URL}" "WALLET_SERVICE_URL=${WALLET_URL}" \
  "ADMIN_SERVICE_URL=${ADMIN_URL}" "AGENT_SERVICE_URL=${AGENT_URL}" "INTERNAL_SECRET=${INTERNAL_SECRET}" \
  "WEB_ORIGIN=${PUBLIC_WEB_ORIGIN}" \
  "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" "TELEGRAM_BOT_USERNAME=${TELEGRAM_BOT_USERNAME}" \
  "SYNC_INTERVAL_MIN=5" \
  "LOKI_URL=${LOKI_URL}" \
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
  "LOKI_URL=${LOKI_URL}" \
  "SERVICE_NAME=svinooh-auth"

# wallet — scan orchestration + SOL/TRON/BTC scanners + result writer.
# Needs ≥ 512MB (no browser of its own any more). config apps/wallet/railway.json
add_repo wallet
setvars wallet \
  "PORT=3000" \
  "DATABASE_URL=${PG_URL}" \
  "RABBITMQ_URL=${RABBIT_URL}" \
  "CHROME_NO_SANDBOX=1" \
  "LOKI_URL=${LOKI_URL}" \
  "SERVICE_NAME=svinooh-wallet"

# scanner-evm — the EVM browser scanner. THE service whose absence caused the
# outage: it declares and drains scan.evm and publishes scan.result.
# Give it ≥ 1GB if SCANNER_ENGINE=chrome; ~512MB is enough for lightpanda.
# config apps/scanner-evm/railway.json (downloads the lightpanda binary at build)
add_repo scanner-evm
setvars scanner-evm \
  "PORT=3000" \
  "RABBITMQ_URL=${RABBIT_URL}" \
  "SCANNER_ENGINE=lightpanda" \
  "CHROME_NO_SANDBOX=1" \
  "LOKI_URL=${LOKI_URL}" \
  "SERVICE_NAME=svinooh-scanner-evm"

# agent — AI agent microservice (Python/FastAPI + LangChain). Internal only; the
# api gateway forwards /ai/* here. Needs its own ANTHROPIC_API_KEY. Not a Node
# service — builds from apps/agent/Dockerfile (config apps/agent/railway.json).
add_repo agent
setvars agent \
  "PORT=3000" \
  "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
  "AGENT_MODEL=anthropic:claude-haiku-4-5" \
  'PORTFOLIO_API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000' \
  "SERVICE_NAME=svinooh-agent"

# monitor-alerts — reads wallet.state, decides what each owner should be told,
# publishes alerts.telegram. THE second service whose absence is felt silently:
# wallet publishes wallet.state to a durable queue whether or not anything
# drains it, so without this the queue grows and nobody is ever told anything.
# config apps/monitor-alerts/railway.json
add_repo monitor-alerts
setvars monitor-alerts \
  "NODE_ENV=production" "PORT=3000" \
  "DATABASE_URL=${PG_URL}" \
  "RABBITMQ_URL=${RABBIT_URL}"

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
  "RABBITMQ_URL=${RABBIT_URL}"

# admin — the tunables, behind the Admin tab in the product.
#
# NOT public, and it must stay that way: no Railway domain, no ingress. Every
# route sits under /internal and refuses anything without INTERNAL_SECRET, so
# the api is the only way in — and the api has already verified the caller's
# token and looked their isAdmin flag up in the database. Two locks checking two
# different things.
#
# Who is an admin is a column on User, set in the database and nowhere else.
# Nothing in the product grants it, so there is no flow to get wrong.
#
# scanner-evm also takes ZERION_API_KEY when scan.evmSource is set to `zerion`
# in the panel. It is a secret, so it lives in that service's variables rather
# than in the registry — that file is public and the panel shows every value in
# it.
#
# If you give this service a watch pattern, it has to cover
# libs/common/src/settings/** as well as apps/admin/**: the registry is where
# the knobs are declared, and a knob added there is a knob this service serves.
add_repo admin
setvars admin \
  "PORT=3000" \
  "DATABASE_URL=${PG_URL}" \
  "INTERNAL_SECRET=${INTERNAL_SECRET}"

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
     wallet       → apps/wallet/railway.json
     scanner-evm  → apps/scanner-evm/railway.json
     monitor-alerts → apps/monitor-alerts/railway.json
     bot-telegram → apps/bot-telegram/railway.json
     web          → apps/web/railway.json          (or Dockerfile path apps/web/Dockerfile)
     prometheus   → ops/prometheus/railway.json
     grafana      → ops/grafana/railway.json
   Root Directory stays "/" for all of them (the Docker build context is the
   monorepo root; the Dockerfile path is relative to it).

2. Volumes — attach a volume to each stateful service at the mount path it
   expects (data lives here; size to taste):
     Postgres → its plugin volume     Redis → its plugin volume
     rabbitmq → /var/lib/rabbitmq      loki  → /loki
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
========================================================================================
MANUAL
echo "done — review the MANUAL STEPS above."
