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
  web/    — Next.js (App Router): the landing is prerendered, the portfolio
            page is a client render. Charts, Telegram login
libs/
  shared/ — the API contract (types only, nothing to build)
  db/     — Prisma schema, migrations and PrismaService, shared by the services
  common/ — cross-service plumbing: auth guards, Prometheus metrics,
            the Loki logger, the OpenTelemetry bootstrap
ops/
  prometheus/, tempo/, grafana/ — the observability services: configs,
            datasources and dashboards, all built from this repo
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

Three ways in, all handled by the auth service:

- **Login widget** — the browser sends Telegram's payload; the backend checks
  the signature (HMAC-SHA256 of the bot token, `auth_date` no older than a day).
- **The bot** — the site opens `t.me/<bot>?start=<token>`, the user presses
  Start, and the tab that is waiting finishes the sign-in by polling
  `/auth/telegram/poll`. That token is one-shot and lives five minutes in
  memory: it belongs to the tab that started, and to nothing else.
- **The link the bot sends back** — the reply carries the user's portfolio URL
  as a button *and* as plain text, with `?login=<key>` on it. Opening it signs
  the visitor in, wherever it is opened: Telegram's own browser, Safari on a
  phone when the sign-in began on a laptop, or a tab opened an hour later.
  Without it the way back depends on the original tab still existing, which is
  where people were being lost. Any message to the bot gets one, so a stale
  link is one `/start` away from being replaced.

  `LoginLink` is a bearer credential and treated as one: 32 random bytes, one
  hour to live, at most 20 opens (the same link really is opened two or three
  times — Telegram's browser, then "open in Safari", then a reload), private
  chats only, and issuing a new one drops the user's older links so the newest
  message in the chat is the only live one. Past the hour the site says so and
  offers the sign-in modal, rather than dropping the visitor on a signed-out
  page with no explanation.

In production turn the dev login off: `AUTH_DEV_MODE=false`.

## The landing is rendered on the server

Every other page is a client render — open the shell, fetch, draw. The landing
could not afford that. It is what a stranger and a crawler arrive on, and it was
arriving as an empty card that filled in over two chained round trips (the
public list decides which portfolio the demo card shows, so the second request
cannot start until the first lands). The page moved twice before it settled.

Next.js renders it instead. `/` is a static route (`app/page.tsx`, `revalidate =
60`): the HTML has the card, the figures and the chart already in it, and the
browser hydrates against exactly that rather than fetching it again. `/p/[slug]`
is left as it was, a client render — a portfolio is a live view of somebody's
money that changes with who is asking, so there is nothing to prerender that
would be right for the next visitor, and a privacy rule that says never to hand
one person's page to another.

Three details make it hold together:

- **The chart is SVG, not canvas.** The portfolio page keeps Lightweight Charts
  — it is interactive there, and you can drag across it to measure a span. A
  canvas cannot exist before JavaScript runs, so the landing uses a plain SVG
  path (`Sparkline`) that is in the markup and painted with the first frame.
- **The theme is applied before the first paint.** The server has no idea which
  theme a visitor keeps, so an inline script sets `data-theme` on `<html>`
  first, and the theme toggle picks its icon in CSS rather than in JavaScript —
  otherwise the server's markup and the browser's first render would disagree.
- **Nothing personal is in the HTML.** It renders signed-out, from public
  endpoints: `owner` is null, wallet labels are null, and hydration is what
  turns it into your page if it is yours.

The page is rebuilt at most once a minute and served from the cache in between,
so the API sees a couple of requests a minute rather than a couple per visitor.
If it is unreachable the landing still renders and fills itself in from the
browser, which is what it did before any of this — it degrades to working.

## The chart, and the phone

One gesture, one meaning, and nothing shares:

| | |
|---|---|
| one finger, dragging | scrolls the chart |
| one finger, held | a crosshair that follows it, for reading the value at a point |
| two fingers | selects the span between them and says what the portfolio did across it |
| a mouse drag | the same selection — a mouse has only the one gesture |

There is no zoom. The period buttons decide how much history is on screen, and a
second, gestural way to change it only ever leaves people at a scale they did
not pick and cannot name. Scrolling still means something without it: a day of
readings squeezed into a phone is two pixels a point, so below a legible density
the chart stops trying to fit the period into the width, shows the recent end,
and lets the rest be scrolled back to.

It installs as an app — manifest, icons, its own window, a splash that isn't a
white flash into a dark page — and the status bar follows the theme you picked
rather than the one your phone is in. The service worker is deliberately small:
it serves Next's content-hashed assets from disk so an installed app opens
without waiting on the network, never touches `/api` because stale money is
worse than no money, and falls back to a page that says "no connection" instead
of the browser's dinosaur.

## API

Everything goes through the api gateway; `/api/auth/*` is forwarded to the auth
service as-is.

```
GET    /api/health
GET    /api/auth/config                       — { botUsername, botId, devMode, syncIntervalMin }
POST   /api/auth/telegram                     — widget payload → { token, me }
POST   /api/auth/telegram/start               — start bot sign-in → { token, deepLink }
GET    /api/auth/telegram/poll?token=         — bot sign-in status
POST   /api/auth/link                         — { token } from the bot's link → { token, me }
POST   /api/auth/dev                          — { name } (only with AUTH_DEV_MODE=true)
GET    /api/auth/me                           🔒

GET    /api/portfolios/public?limit=&q=       — leaderboard/search of public portfolios (landing)
GET    /api/portfolios/:slug                  — public; with a token it returns isOwner
PATCH  /api/portfolios/:slug                  🔒 { name }
GET    /api/portfolios/:slug/history?range=24h|7d|30d|all
POST   /api/portfolios/anonymous              — { address } → open a wallet as a portfolio
                                                that belongs to nobody, creating it if needed
POST   /api/portfolios/:slug/wallets          { address } — the network is detected, the
                                                response is immediate (status=pending) and the
                                                scan runs asynchronously. Owner-only on an owned
                                                portfolio; open to anyone on an anonymous one
PATCH  /api/portfolios/:slug/wallets/:id      🔒 { label }
DELETE /api/portfolios/:slug/wallets/:id      🔒
GET    /api/portfolios/:slug/wallets/:id/history?range=…
```

An unrecognized address → 400 `{ code: "UNSUPPORTED_NETWORK" }`, a duplicate →
409 `{ code: "WALLET_EXISTS" }`, an anonymous portfolio that is already full →
400 `{ code: "ANONYMOUS_LIMIT" }`.

### Portfolios nobody owns

Searching a wallet address on the landing opens it as a portfolio with no owner,
and **anyone can add wallets to it without an account** — assemble one, share the
link, decide about signing up later. Renaming and removing stay owner-only, so an
open portfolio can be built up but not taken apart. It is capped at ten wallets,
because nobody owns it and everything in it is rescanned for as long as it exists.

Reaching for an owner-only action offers to **claim** it
(`POST /portfolios/:slug/claim`): the portfolio becomes yours, wallets and all.
Signed out, the intent is parked in `sessionStorage` and completed by whichever
sign-in follows — including the Telegram round trip through another tab — so the
login lands you back on the portfolio you were building rather than on a fresh
empty one. Claiming makes it private, and drops the empty portfolio that signing
in creates, so an account still ends up with exactly one.

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
- **A chart's first point is not evidence**: bad scans arrive in runs — measured
  at 7 to 11 snapshots on a live portfolio, half an hour of a scanner having a
  bad time. When a run straddles the edge of a window, the first sample in view
  is a glitch and there is nothing to its left to catch it, so a 24h chart would
  open at a fifth of the portfolio and report +342% on a day it had not moved.
  The level a window opens at is therefore taken from the high-water mark of the
  wallet's last 40 snapshots before it: a bad scan reads poor, never rich, so the
  largest recent reading is the one that cannot be a glitch. Nothing is rewritten
  to it — it only decides whether the first sample looks like a drop, and a drop
  is held only when the series climbs back, so a real fall stays a real fall.
- **A hold is not a failure**: when we skip a result on purpose — an unconfirmed
  drop, or the EVM backoff below — the wallet is left exactly as it was rather
  than marked `failed`. Telling someone their sync broke when we chose to skip a
  cycle is both wrong and alarming; going stale is the honest signal.
- **Back off when DeBank throttles**: a Chrome scan is retried once, and after
  four failures in a row EVM scanning pauses for ten minutes instead of coming
  straight back for more.
- One network failing doesn't take the cycle down; retries with backoff on 5xx.
- Assets with no price (TRC10, unlisted tokens) aren't swallowed — they come back
  in `unpriced` and are flagged in the UI.

## The scan queue and history

The wallet service keeps a RabbitMQ queue of addresses. A producer tops it up
with the addresses that are **due**, a consumer takes them one at a time
(`SCAN_PREFETCH`) with a pause after each (`SCAN_JOB_DELAY_MS`). Identical
addresses in different portfolios are scanned once.

Due-ness has two tiers, because most of the load comes from wallets nobody is
looking at:

| Tier | Every | Which wallets |
|---|---|---|
| fast | `SYNC_INTERVAL_MIN` (5 min) | in someone's own portfolio, or in one opened within `SYNC_ACTIVE_WINDOW_MIN` |
| slow | `SYNC_IDLE_INTERVAL_MIN` (30 min) | only in anonymous portfolios nobody has opened lately |

An address in several portfolios takes the fastest tier any of them asks for,
and the fast tier is enqueued first. Opening a portfolio stamps `lastViewedAt`,
so its wallets are back on the fast tier within one top-up.

This matters more than it looks: the producer used to refill the moment the
queue drained, so everything was rescanned every ~1.8 minutes no matter what
`SYNC_INTERVAL_MIN` said — about 4,800 DeBank page loads a day from one
datacenter IP, which is what got the EVM scans throttled into timeouts. After each successful scan a
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
  links back to its logs. Its datasources and dashboards live in `ops/grafana`
  and are baked into the image, so a fresh container comes up already
  configured; edits made in the UI are kept by the volume, and exporting one
  back into `ops/grafana/dashboards` is how it gets committed.

All four observability services have a persistent volume — `/prometheus`,
`/loki`, `/var/tempo` and `/var/lib/grafana` — so a restart no longer loses the
metrics, logs and traces collected so far. They also set `RAILWAY_RUN_UID=0`:
Railway mounts volumes as root while these images run as a non-root user, and
without it they cannot write to their own storage.

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
(`apps/<name>/railway.json`, Root Directory `/`); prometheus, tempo and grafana
the same way from `ops/<name>/railway.json`. Only `api`, `web` and `grafana`
have public domains — everything else talks over `*.railway.internal`.

Four services carry a volume, so their data survives a restart:

| Service | Mount | Holds |
|---|---|---|
| `prometheus` | `/prometheus` | the metrics TSDB |
| `loki` | `/loki` | log chunks and indexes |
| `tempo` | `/var/tempo` | the trace WAL and blocks |
| `grafana` | `/var/lib/grafana` | its database — users, preferences, UI edits |

All four also set `RAILWAY_RUN_UID=0`: Railway mounts volumes as root while
these images run as a non-root user, and without it they cannot write to their
own storage. Grafana's datasources and dashboards come from the image rather
than the volume, so even an empty one starts up configured.

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
web     NEXT_PUBLIC_API_URL = https://<api domain>  (inlined into the browser
                                               bundle at build time — rebuild
                                               after changing it; the server
                                               reads it again to render the
                                               landing)
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
- A retention policy for anonymous portfolios: nobody owns them, so nobody
  deletes them, and each one is rescanned forever.
