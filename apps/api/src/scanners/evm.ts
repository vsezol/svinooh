import { Logger } from '@nestjs/common';
import { config } from '../config';
import { scanEvmBrowser } from './evm-browser';
import { scanEvmHttp } from './evm-http';
import type { ScanResult } from './types';

const logger = new Logger('EvmScanner');

/**
 * Первично — быстрый HTTP к debank.com (реверс-подпись, evm-http.ts). При
 * ЛЮБОЙ осечке — прозрачный откат на чтение отрисованной страницы через
 * headless Chrome (evm-browser.ts). Так задумал пользователь: HTTP дешёвый,
 * но хрупкий; браузер — медленный, но переживает смену их API.
 *
 * Circuit breaker: если datacenter-IP словил софт-бан DeBank (стабильные
 * 429), нет смысла каждый скан тратить ~2с на HTTP-осечку И продолжать долбить
 * забаненный эндпоинт, продлевая бан. После N подряд осечек HTTP «размыкается»
 * на cooldown — сканы идут СРАЗУ в Chrome. По истечении cooldown один пробный
 * HTTP: успех — замыкаем обратно, осечка — снова пауза.
 */

const BREAKER_THRESHOLD = 3; // столько подряд осечек HTTP размыкают цепь
const BREAKER_COOLDOWN_MS = 30 * 60_000; // на сколько отключаем HTTP

let consecutiveFailures = 0;
let openedUntil = 0; // timestamp, до которого HTTP пропускаем

function httpAllowedNow(): boolean {
  if (!config.evmHttpEnabled) return false;
  if (openedUntil === 0) return true;
  if (Date.now() >= openedUntil) {
    // half-open: даём одну пробную попытку
    openedUntil = 0;
    return true;
  }
  return false;
}

function noteHttpSuccess(): void {
  consecutiveFailures = 0;
  openedUntil = 0;
}

function noteHttpFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD && openedUntil === 0) {
    openedUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logger.warn(
      `HTTP-путь DeBank размкнут на ${BREAKER_COOLDOWN_MS / 60_000} мин после ${consecutiveFailures} осечек подряд — сканы идут через Chrome`,
    );
  }
}

export async function scanEvm(address: string): Promise<ScanResult> {
  if (httpAllowedNow()) {
    try {
      const result = await scanEvmHttp(address);
      noteHttpSuccess();
      logger.log(`${address}: HTTP debank $${result.totalUsd.toFixed(2)}`);
      return result;
    } catch (error) {
      noteHttpFailure();
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`${address}: HTTP-путь осёкся (${message}) → фоллбэк на Chrome`);
    }
  }
  const result = await scanEvmBrowser(address);
  logger.log(`${address}: Chrome debank $${result.totalUsd.toFixed(2)}`);
  return result;
}
