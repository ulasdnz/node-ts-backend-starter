import type { Redis } from 'ioredis';
import type { Logger } from 'winston';
import { logger as appLogger } from './logger.js';
import { redisClient } from './redis.js';
import { singleflight } from './singleflight.js';

export type CacheClient = Pick<Redis, 'get' | 'set' | 'del'>;

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Resolves to false instead of throwing when Redis failed, so callers can decide how loud to be. */
  del(key: string): Promise<boolean>;
  /** Cache-aside: returns the cached value or loads, stores and returns it. */
  wrap<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Redis-backed cache that treats Redis as an optimisation, never as a dependency: a failed read is a
 * miss and a failed write is skipped, both logged. Concurrent misses for one key load only once.
 */
export const createCache = (client: CacheClient, logger: Pick<Logger, 'warn'>): Cache => {
  const get = async <T>(key: string): Promise<T | null> => {
    try {
      const raw = await client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      logger.warn('Cache read failed, falling back to the source', {
        event: 'cache.get.failed',
        key,
        error: messageOf(error),
      });
      return null;
    }
  };

  const set = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('Cache write failed', {
        event: 'cache.set.failed',
        key,
        error: messageOf(error),
      });
    }
  };

  const del = async (key: string): Promise<boolean> => {
    try {
      await client.del(key);
      return true;
    } catch (error) {
      logger.warn('Cache delete failed', {
        event: 'cache.del.failed',
        key,
        error: messageOf(error),
      });
      return false;
    }
  };

  const wrap = <T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> =>
    singleflight(key, async () => {
      const cached = await get<T>(key);
      if (cached !== null) return cached;

      const value = await load();
      if (value !== null && value !== undefined) await set(key, value, ttlSeconds);
      return value;
    });

  return { get, set, del, wrap };
};

export const cache = createCache(redisClient, appLogger);
