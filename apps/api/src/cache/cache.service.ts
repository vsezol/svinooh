import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Cache of collected portfolio data. With Redis it's shared and survives restarts;
 * without REDIS_URL (locally) it's an in-memory Map with TTL so dev doesn't need
 * Redis. A cache error never breaks the request — it's an accelerator, not a
 * source of truth.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null = null;
  private readonly mem = new Map<string, { v: string; exp: number }>();

  constructor(private readonly metrics: MetricsService) {
    if (config.redisUrl) {
      this.redis = new Redis(config.redisUrl, {
        family: 0, // Railway private network — IPv6
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
      });
      this.redis.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
      this.redis.on('connect', () => this.logger.log('Redis connected'));
    } else {
      this.logger.log('REDIS_URL not set — cache is in-memory');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.read<T>(key);
    this.metrics.cacheOps.inc({ op: value === null ? 'miss' : 'hit' });
    return value;
  }

  private async read<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const raw = await this.redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      }
      const hit = this.mem.get(key);
      if (!hit) return null;
      if (hit.exp < Date.now()) {
        this.mem.delete(key);
        return null;
      }
      return JSON.parse(hit.v) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (this.redis) await this.redis.set(key, raw, 'EX', ttlSec);
      else this.mem.set(key, { v: raw, exp: Date.now() + ttlSec * 1000 });
    } catch {
      // non-critical
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (this.redis) await this.redis.del(key);
      else this.mem.delete(key);
    } catch {
      // non-critical
    }
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }
}
