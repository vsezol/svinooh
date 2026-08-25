import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// .env лежит в корне apps/api. В рантайме __dirname — apps/api/dist (после
// nest build) или apps/api/src (под tsx) — в обоих случаях ../.env верен.
// Реальные переменные окружения имеют приоритет над файлом (семантика --env-file).
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // нет прав или битый файл — работаем на том, что есть в окружении
  }
}

// PrismaClient читает DATABASE_URL из process.env через schema.prisma
process.env.DATABASE_URL ??= 'postgresql://svinooh:svinooh@localhost:5432/svinooh';

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  port: int(process.env.PORT, 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
  devMode: bool(process.env.AUTH_DEV_MODE, false),
  syncIntervalMin: int(process.env.SYNC_INTERVAL_MIN, 5),
  // Публичный URL веб-приложения — для кнопки «вернуться на сайт» в боте.
  webUrl: (process.env.WEB_URL || 'https://svinooh.com').replace(/\/+$/, ''),
  // Сколько циклов подряд должно подтвердиться резкое падение стоимости
  // кошелька, прежде чем мы ему поверим. Разовые просадки (частичный ответ
  // источника, глюк Chrome) так не попадают в историю и не рисуют «пилу».
  dropConfirmCycles: int(process.env.SYNC_DROP_CONFIRM_CYCLES, 3),
  // Очередь сканов (RabbitMQ) и кэш (Redis). Пусто — работаем без брокера:
  // скан идёт in-process тем же паровозом, кэш становится in-memory. Так
  // локальная разработка не требует поднимать Rabbit/Redis.
  rabbitUrl: process.env.RABBITMQ_URL || null,
  redisUrl: process.env.REDIS_URL || null,
  scanQueueName: process.env.SCAN_QUEUE_NAME || 'wallet.scan',
  // Пейсинг: пауза после каждого скана — «потихоньку», чтобы реже ловить 429.
  scanJobDelayMs: int(process.env.SCAN_JOB_DELAY_MS, 1500),
  // Сколько адресов разгребать одновременно. 1 = строго по одному (мягче всего
  // к лимитам). Можно поднять, когда HTTP-путь перестанет ловить 429.
  scanPrefetch: int(process.env.SCAN_PREFETCH, 1),
  // Как часто проверять, что очередь опустела, и заливать кошельки заново.
  scanReloadSec: int(process.env.SCAN_RELOAD_SEC, 15),
  // TTL кэша собранного портфеля в Redis (сек).
  cacheTtlSec: int(process.env.CACHE_TTL_SEC, 60),
  // Loki для логов. Пусто — шлём только в stdout (Railway), без Loki.
  lokiUrl: process.env.LOKI_URL || null,
  webOrigin: process.env.WEB_ORIGIN || '*',
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 15_000),
  evmTimeoutMs: int(process.env.EVM_TIMEOUT_MS, 90_000),
  // Конкурентность HTTP-сканеров BTC/SOL/TRON.
  httpConcurrency: int(process.env.SCAN_HTTP_CONCURRENCY, 4),
  // EVM: первичный путь — HTTP к debank.com (реверс-подпись), при осечке
  // фоллбэк на headless Chrome. Chrome-часть сериализуется отдельным локом
  // (никогда не 2 инстанса разом), поэтому HTTP можно гнать пулом.
  evmHttpEnabled: bool(process.env.EVM_HTTP_ENABLED, true),
  evmHttpConcurrency: int(process.env.EVM_HTTP_CONCURRENCY, 3),
  // Необязательный прокси для debank.com — на случай, если Cloudflare начнёт
  // резать датацентровый IP (Railway). Пусто — прямое соединение.
  debankProxyUrl: process.env.DEBANK_PROXY_URL || null,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  chromeNoSandbox: bool(process.env.CHROME_NO_SANDBOX, false),
};
