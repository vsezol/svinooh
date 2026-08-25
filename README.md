# 🐷 Свиноух

Трекер крипто-портфеля: кидаешь адреса кошельков (BTC / EVM / SOL / TRON),
сервис сам определяет сеть, считает стоимость всех активов — включая
DeFi-позиции и стейк — пишет историю и рисует графики. Портфель открывается
по публичной ссылке без входа; вход (через Telegram) нужен только чтобы
завести свой.

## Структура

Nx-монорепа (package-based: npm workspaces + nx для запуска/кэша задач).
Структура допускает добавление Python-приложений (apps/* с собственным
project.json) без переделки — под будущие аналитические задачи.

```
apps/
  api/   — NestJS + Prisma (PostgreSQL): сканеры сетей, auth, портфели,
           фоновый синк, история
  web/   — React (Vite) + recharts: страница портфеля, графики, TG-логин
libs/
  shared/ — типы API-контракта (только типы, сборки нет)
```

## Быстрый старт локально

```bash
npm install
docker compose up -d db                 # PostgreSQL 16 на localhost:5432
cp apps/api/.env.example apps/api/.env  # дефолты уже рабочие, AUTH_DEV_MODE=true
npm run -w apps/api migrate:dev         # миграции
npm run dev                             # api :3000 + web :5173 (nx run-many)
```

Открываешь http://localhost:5173, входишь через **dev-вход** (Telegram на
localhost не работает — виджету нужен домен, привязанный к боту), вставляешь
адрес кошелька — дальше всё само.

Проверка сканеров на контрольных кошельках (сети, суммы, позиции):

```bash
npm run verify:scanners            # все сети; можно -- btc|sol|tron|evm
```

## Вход через Telegram

1. У [@BotFather](https://t.me/BotFather): `/newbot` → получить токен.
2. Там же `/setdomain` → домен web-приложения (прод-домен Railway).
3. В переменные **api**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
   (без @). Кнопка на главной появится сама (`GET /api/auth/config`).

Подпись виджета проверяется на бэке (HMAC-SHA256 от bot token,
`auth_date` не старше суток). В проде выключи dev-вход: `AUTH_DEV_MODE=false`.

## API

```
GET    /api/health
GET    /api/auth/config                       — { botUsername, devMode, syncIntervalMin }
POST   /api/auth/telegram                     — payload виджета → { token, me }
POST   /api/auth/dev                          — { name } (только AUTH_DEV_MODE=true)
GET    /api/auth/me                           🔒

GET    /api/portfolios/public?limit=&q=       — лидерборд/поиск публичных портфелей (лендинг)
GET    /api/portfolios/:slug                  — публичный; с токеном вернёт isOwner
PATCH  /api/portfolios/:slug                  🔒 { name }
GET    /api/portfolios/:slug/history?range=24h|7d|30d|all
POST   /api/portfolios/:slug/wallets          🔒 { address } — сеть определяется сама,
                                                ответ сразу (status=pending), скан асинхронный
DELETE /api/portfolios/:slug/wallets/:id      🔒
GET    /api/portfolios/:slug/wallets/:id/history?range=…
```

Неопознанный адрес → 400 `{ code: "UNSUPPORTED_NETWORK" }`, дубль → 409
`{ code: "WALLET_EXISTS" }`.

## Как считается стоимость

| Сеть | Источник | Особенности |
|---|---|---|
| BTC | mempool.space | подтверждённое + мемпул; blockchair банит по IP — не используем |
| SOL | Jupiter portfolio API + GMX-Solana индексатор | Jupiter — полноценный DeFi-агрегатор (Kamino, Meteora, …); GM-пулы GMTrade он видит, но не оценивает — их цена берётся как **NAV** (`gmPriceNow / 1e11`), НЕ TVL/supply (тот завышает на 8–12%) |
| TRON | TronGrid + DefiLlama | застейканный TRX (Stake 2.0) не лежит в `balance` — берём frozenV2 + delegated_frozenV2\_\*, исключая acquired\_\* (чужой TRX) |
| EVM | **HTTP → debank.com** (реверс-подпись), фоллбэк на headless Chrome | тотал = `project_list` (ончейн-DeFi) + `app_list` (Hyperliquid и пр.) + `cache_balance_list` (токены) — три источника, которые складывает и сам фронт DeBank; при осечке — чтение отрисованной страницы через Chrome |

### EVM: HTTP-первый, Chrome-фоллбэк

Первично EVM ходит по HTTP к веб-API debank.com, воспроизводя клиентскую
подпись (`x-api-nonce`/`x-api-sign`/`x-api-ts`) — те же запросы, что делает
браузер любого анонимного посетителя profile-страницы (данные там бесплатны,
без входа; отдельный платный Portfolio API с ключом мы не трогаем). Порт
[debank-re](https://github.com/lukks/debank-re) на TS + `impit` (TLS-отпечаток
Chrome, иначе Cloudflare режет по JA3).

Тотал собирается ровно как на фронте DeBank — сумма трёх непересекающихся
источников: `project_list` + `app_list` + `cache_balance_list`. **`app_list`
обязателен**: там лежит Hyperliquid и подобные «приложения» (у контрольного
кошелька $3 512 из $27 485) — без него тихий недобор. Кросс-чек против
`total_net_curve`: если наша сумма ниже кривой на >10%, считаем прогон
неполным и откатываемся на Chrome, а не пишем заниженное число.

При **любой** осечке HTTP (протухла подпись, 429/Cloudflare, IP-бан, недобор)
— прозрачный фоллбэк на headless Chrome, читающий отрисованную страницу.
Отключить HTTP-путь целиком: `EVM_HTTP_ENABLED=false`. Прокси для DeBank (если
датацентровый IP забанят): `DEBANK_PROXY_URL`.

Правила надёжности (тихо неверная цифра хуже упавшего запроса):

- **Никогда не два headless Chrome разом**: параллельные инстансы душат друг
  друга и молча возвращают $0. Chrome-путь сериализован локом (лимит 1);
  HTTP-путь при этом гонится пулом (`EVM_HTTP_CONCURRENCY`, дефолт 3).
- **Санити-чек**: падение до <5% от прошлого значения → повторный скан;
  два замера разошлись → прогон помечается `failed`, история НЕ пишется,
  отдаётся прошлое значение со `stale: true`.
- Ошибка одной сети не роняет цикл; ретраи с бэкоффом на 5xx/429.
- Активы без цены (TRC10, токены без листинга) не съедаются молча — поле
  `unpriced` в ответе и пометка в UI.

## Фоновый синк и история

Каждые `SYNC_INTERVAL_MIN` (по умолчанию 5) минут пересканируются все
кошельки (одинаковые адреса в разных портфелях — один скан). После каждого
успешного скана пишется `WalletSnapshot`, после цикла — `PortfolioSnapshot`.
Графики: 24ч — сырые точки, 7д/30д/всё — бакеты `date_bin` на стороне
Postgres (30 мин / 2 ч / 6 ч).

## Деплой на Railway

Три сервиса в одном проекте:

1. **PostgreSQL** — плагин Railway.
2. **api** — из этого репозитория: Config-as-code path =
   `apps/api/railway.json` (Dockerfile с chromium для puppeteer).
   Переменные:
   ```
   DATABASE_URL      = ${{Postgres.DATABASE_URL}}
   JWT_SECRET        = <случайная длинная строка>
   TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME
   WEB_ORIGIN        = https://<домен web>
   AUTH_DEV_MODE     = false
   ```
   Памяти нужно ≥ 1 ГБ (headless Chrome). Healthcheck: `/api/health`.
3. **web** — Config path = `apps/web/railway.json`. Переменная:
   ```
   VITE_API_URL = https://<домен api>
   ```
   (зашивается в статику при сборке — после смены пересобрать).

Миграции применяются автоматически при старте api (`prisma migrate deploy`).

⚠️ DeBank за Cloudflare: с датацентровых IP возможны капчи — если EVM-сканы
на Railway начнут падать, это первое, что стоит проверить (локально всё ок).

## Что дальше (задел)

- Несколько портфелей на пользователя — схема уже это допускает.
- Вход через Twitter/X — рядом с Telegram в auth-модуле.
- Telegram-бот/mini-app — монорепа готова принять `apps/bot`.
- Python-аналитика — package-based Nx позволяет добавить без переделки.
