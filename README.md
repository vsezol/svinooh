# 🐷 Svinooh

Crypto portfolio tracker: you paste wallet addresses (BTC / EVM / SOL / TRON),
the service works out the network itself, values every asset — DeFi positions
and staking included — records history and draws the charts. A portfolio opens
from a public link with no sign-in; signing in (via Telegram) is only needed to
create your own.

## Structure

An Nx monorepo (package-based: npm workspaces + nx for running/caching tasks).
The layout also accepts Python apps (`apps/*` with their own `project.json`)
without rework — for future analytics work.

```
apps/
  api/    — gateway (NestJS): portfolios, history, Redis cache, JWT verification,
            /auth/* proxied to the auth service
  auth/   — sign-in (NestJS): Telegram bot and login widget, issues JWTs, owns User
  wallet/ — scanning (NestJS): RabbitMQ queue, the chain scanners, snapshots
  web/    — React (Vite): portfolio page, charts, Telegram login
libs/
  shared/ — the API contract (types only, nothing to build)
  db/     — Prisma schema, migrations and PrismaService, shared by the services
  common/ — cross-service plumbing: auth guards, Prometheus metrics,
            the Loki logger, the OpenTelemetry bootstrap
ops/
  prometheus/, tempo/ — the observability services' configs (Docker images)
```

### How the services talk

```
web ──HTTPS+JWT──▶ api ──HTTP /auth/*───▶ auth ──▶ Telegram Bot API
                    │
                    ├──HTTP /internal/scan──▶ wallet ──▶ RabbitMQ (its own scan queue)
                    ├──▶ Redis (assembled-portfolio cache)
                    └──▶ Postgres ◀── auth, wallet
```

Postgres is shared, with ownership by table: **auth** writes `User`, **wallet**
writes `Wallet` / `Position` / `WalletSnapshot`, **api** writes `Portfolio` and
reads everything. Only the api is exposed publicly; the other two are reachable
over Railway's private network. JWTs are signed by auth and verified by api,
which means both need the same `JWT_SECRET`.

## Quick start locally

```bash
npm install
docker compose up -d db                       # PostgreSQL 16 on localhost:5432
cp apps/api/.env.example apps/api/.env        # defaults work as-is, AUTH_DEV_MODE=true
cp apps/auth/.env.example apps/auth/.env
cp apps/wallet/.env.example apps/wallet/.env
npm run -w @svinooh/db migrate:dev            # migrations
npm run dev                                   # all services + web :5173 (nx run-many)
```

Open http://localhost:5173, sign in with **dev login** (Telegram doesn't work on
localhost — the widget needs a domain bound to the bot), paste a wallet address
and the rest takes care of itself.

Neither RabbitMQ, Redis, Loki nor Tempo are needed locally: with their variables
unset the wallet service scans in-process on a timer, the cache is in-memory and
logs/traces go to stdout only.

Checking the scanners against the control wallets (networks, totals, positions):

```bash
npm run -w apps/wallet verify:scanners        # all networks; add -- btc|sol|tron|evm
```

## Signing in with Telegram

1. With [@BotFather](https://t.me/BotFather): `/newbot` → get a token.
2. There too `/setdomain` → the web app's domain (the production Railway domain).
3. Into the **auth** service's variables: `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_BOT_USERNAME` (no @). The button on the home page appears by
   itself (`GET /api/auth/config`).

Two ways in, both handled by the auth service:

- **Login widget** — the browser sends Telegram's payload; the backend checks
  the signature (HMAC-SHA256 of the bot token, `auth_date` no older than a day).
- **The bot** — the site opens `t.me/<bot>?start=<token>`, the user taps Start,
  the bot replies with a button that leads straight to their own portfolio
  (`/p/<slug>?tg_login=<token>`). The site finishes signing in from that token,
  so returning without tapping the button works too — it is kept in
  `sessionStorage` and polled.

In production turn the dev login off: `AUTH_DEV_MODE=false`.

## API

Everything goes through the api gateway; `/api/auth/*` is forwarded to the auth
service as-is.

```
GET    /api/health
GET    /api/auth/config                       — { botUsername, botId, devMode, syncIntervalMin }
POST   /api/auth/telegram                     — widget payload → { token, me }
POST   /api/auth/telegram/start               — start bot sign-in → { token, deepLink }
GET    /api/auth/telegram/poll?token=         — bot sign-in status
POST   /api/auth/dev                          — { name } (only with AUTH_DEV_MODE=true)
GET    /api/auth/me                           🔒

GET    /api/portfolios/public?limit=&q=       — leaderboard/search of public portfolios (landing)
GET    /api/portfolios/:slug                  — public; with a token it returns isOwner
PATCH  /api/portfolios/:slug                  🔒 { name }
GET    /api/portfolios/:slug/history?range=24h|7d|30d|all
POST   /api/portfolios/:slug/wallets          🔒 { address } — the network is detected,
                                                the response is immediate (status=pending),
                                                the scan runs asynchronously
PATCH  /api/portfolios/:slug/wallets/:id      🔒 { label }
DELETE /api/portfolios/:slug/wallets/:id      🔒
GET    /api/portfolios/:slug/wallets/:id/history?range=…
```

An unrecognized address → 400 `{ code: "UNSUPPORTED_NETWORK" }`, a duplicate →
409 `{ code: "WALLET_EXISTS" }`.

## How the value is computed

| Network | Source | Notes |
|---|---|---|
| BTC | mempool.space (blockstream.info as a fallback) | confirmed + mempool; blockchair bans by IP — we don't use it |
| SOL | Jupiter portfolio API + the GMX-Solana indexer | Jupiter is a full DeFi aggregator (Kamino, Meteora, …); it sees GMTrade's GM pools but doesn't price them — their price is taken as **NAV** (`gmPriceNow / 1e11`), NOT TVL/supply (which overstates by 8–12%) |
| TRON | TronGrid + DefiLlama | staked TRX (Stake 2.0) isn't in `balance` — we take frozenV2 + delegated_frozenV2\_\*, excluding acquired\_\* (someone else's TRX) |
| EVM | **HTTP → debank.com** (reverse-engineered signature), falling back to headless Chrome | total = `project_list` (on-chain DeFi) + `app_list` (Hyperliquid and friends) + `cache_balance_list` (tokens) — the same three sources DeBank's own front end adds up; on a miss, read the rendered page through Chrome |

### Position detail

A protocol is not one row. DeBank's `portfolio_item_list` and Jupiter's elements
split it by kind ("Lending", "Liquidity Pool", "Deposit", "Staked") and carry the
legs each position is made of, and we surface all of it:

- **supply** — what is deposited (an LP shows its actual pair)
- **reward** — accrued but unclaimed: LP fees, farming rewards
- **borrow** — debt, subtracted from the position
- plus APY and the health factor where the source reports them

Jupiter reports headroom in `[0, 1)` while DeBank reports a classic health
factor; headroom is converted with `1 / (1 − headroom)` so one number means one
thing across every chain.

### EVM: HTTP first, Chrome as the fallback

EVM primarily goes over HTTP to the debank.com web API, reproducing the client
signature (`x-api-nonce`/`x-api-sign`/`x-api-ts`) — the same requests the
browser of any anonymous visitor to a profile page makes (that data is free and
needs no login; we don't touch the separate paid Portfolio API with a key). A TS
port of [debank-re](https://github.com/lukks/debank-re) plus `impit` (Chrome's
TLS fingerprint — without it Cloudflare cuts us off on JA3).

The total is assembled exactly as DeBank's front end does — the sum of three
non-overlapping sources: `project_list` + `app_list` + `cache_balance_list`.
**`app_list` is required**: Hyperliquid and similar "apps" live there (on the
control wallet that's $3,512 of $27,485) — skip it and you silently undercount.
Cross-check against `total_net_curve`: if our sum is more than 10% below the
curve we treat the run as incomplete and fall back to Chrome rather than writing
an understated number.

On **any** HTTP miss (stale signature, 429/Cloudflare, IP ban, undercount) it
transparently falls back to headless Chrome, which reads the rendered page. That
fallback also **intercepts the JSON the page fetches for itself**, so it produces
the same per-position detail as the direct API path — which matters because from
a datacenter IP the direct call is the thing that gets rate-limited. Disable the
HTTP path entirely with `EVM_HTTP_ENABLED=false`; a proxy for DeBank (if the
datacenter IP gets banned) is `DEBANK_PROXY_URL`.

Reliability rules (a silently wrong number is worse than a failed request):

- **Never two headless Chrome at once**: parallel instances choke each other and
  silently return $0. The Chrome path is serialized by a lock (limit 1), while
  the HTTP path runs with a pool (`EVM_HTTP_CONCURRENCY`, default 3).
- **Sanity check**: a drop of more than 25% triggers an immediate re-scan, and a
  drop is only believed once it holds for `SYNC_DROP_CONFIRM_CYCLES` cycles in a
  row. Until then the wallet keeps its last known value with `stale: true` and no
  snapshot is written — so a source glitch never draws a sawtooth on the chart.
- One network failing doesn't take the cycle down; retries with backoff on 5xx.
- Assets with no price (TRC10, unlisted tokens) aren't swallowed — they come back
  in `unpriced` and are flagged in the UI.

## The scan queue and history

The wallet service keeps a RabbitMQ queue of addresses. A producer refills it
whenever it drains (`SCAN_RELOAD_SEC`), a consumer takes them one at a time
(`SCAN_PREFETCH`) with a pause after each (`SCAN_JOB_DELAY_MS`) — deliberately
slow, so upstream rate limits are hit less often. Identical addresses in
different portfolios are scanned once. After each successful scan a
`WalletSnapshot` is written, and a `PortfolioSnapshot` after the portfolio is
recomputed. Without `RABBITMQ_URL` the same work runs in-process on a timer,
which is what local development uses.

The api serves assembled portfolios from Redis (`CACHE_TTL_SEC`), so reads never
wait on a scan. Charts: 24h uses raw points, 7d/30d/all use `date_bin` buckets on
the Postgres side (30 min / 2 h / 6 h).

## Observability (LGTM)

- **Metrics** — every service exposes `/metrics` (prom-client): HTTP rate and
  latency, scans by chain and result, cache hits/misses, errors by type, queue
  depth, wallet counts, plus the Node runtime. Prometheus scrapes them over the
  private network, and scrapes Loki and Tempo too.
- **Logs** — `LokiLogger` prints to stdout and ships batches to Loki, labelled
  by service, level and context. Lines written inside a traced request carry
  `trace_id=…`.
- **Traces** — OpenTelemetry → Tempo. Instrumentation is loaded ahead of the app
  with `node -r @svinooh/common/dist/tracing` (it patches modules as they're
  required, so anything already loaded would never be traced). One request
  through web → api → auth/wallet → Postgres/Redis/RabbitMQ is a single trace.
- **Grafana** ties them together: a log line links to its trace, and a trace
  links back to its logs. Its datasources and dashboards are files in
  `ops/grafana`; `ops/grafana/apply.sh` pushes them into an instance and is
  idempotent, so a wiped Grafana is one command away from being itself again.

⚠️ None of the four observability services has a volume yet, so a restart still
loses the metrics, logs and traces collected so far (the dashboards come back
with `apply.sh`). Adding one in the Railway dashboard per service fixes it —
mount `/prometheus`, `/loki`, `/var/tempo` and `/var/lib/grafana` respectively.
`RAILWAY_RUN_UID=0` is already set on all four, which these non-root images need
in order to write to a Railway volume.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` / `LOKI_URL` to turn traces / logs shipping on;
unset, both are no-ops.

## Deploying on Railway

One project, eleven services:

| Service | What it is |
|---|---|
| `Postgres`, `Redis`, `rabbitmq` | data and messaging |
| `api`, `auth`, `wallet`, `web` | the application |
| `prometheus`, `loki`, `tempo`, `grafana` | observability |

Each app service is deployed from this repository with Config-as-code
(`apps/<name>/railway.json`, Root Directory `/`); prometheus and tempo the same
way from `ops/<name>/railway.json`. Only `api`, `web` and `grafana` have public
domains — everything else talks over `*.railway.internal`.

Wiring between services uses Railway reference variables
(`${{Postgres.DATABASE_URL}}`, `${{tempo.RAILWAY_PRIVATE_DOMAIN}}`, …) rather
than hardcoded URLs: it keeps secrets in one place, and it's what draws the
arrows on the project canvas.

Key variables:

```
api     DATABASE_URL, JWT_SECRET, REDIS_URL, AUTH_SERVICE_URL, WALLET_SERVICE_URL,
        WEB_ORIGIN, LOKI_URL, OTEL_EXPORTER_OTLP_ENDPOINT, SERVICE_NAME
auth    DATABASE_URL, JWT_SECRET (same as api), TELEGRAM_BOT_TOKEN,
        TELEGRAM_BOT_USERNAME, WEB_URL, AUTH_DEV_MODE=false, LOKI_URL, OTEL_…
wallet  DATABASE_URL, RABBITMQ_URL, CHROME_NO_SANDBOX=1, LOKI_URL, OTEL_…
web     VITE_API_URL = https://<api domain>   (baked into the static build —
                                               rebuild after changing it)
```

The wallet service needs ≥ 1 GB of memory (headless Chrome). Migrations are
applied automatically when the api starts (`prisma migrate deploy`) — it is the
only service that writes the schema.

⚠️ DeBank sits behind Cloudflare: datacenter IPs see 429s and captchas. That's
the first thing to check if EVM scans start failing on Railway while working
locally — the Chrome fallback covers it, `DEBANK_PROXY_URL` covers it better.

## What's next (groundwork)

- Several portfolios per user — the schema already allows it.
- Sign-in with Twitter/X — next to Telegram in the auth service.
- A Telegram bot / mini-app — the monorepo is ready for `apps/bot`.
- Python analytics — package-based Nx accepts it without rework.
- Volumes for Prometheus / Loki / Tempo / Grafana — see the warning above.
