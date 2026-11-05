import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { createRedisMock, type RedisMock } from '../../test/helpers/redis-mock.js';
import { createCache, type Cache, type CacheClient } from '../cache.js';

let redis: RedisMock;
let logger: { warn: ReturnType<typeof vi.fn> };
let cache: Cache;

beforeEach(() => {
  redis = createRedisMock();
  logger = { warn: vi.fn() };
  cache = createCache(redis as unknown as CacheClient, logger as unknown as Logger);
});

describe('createCache', () => {
  it('wrap stores a miss and serves the next call from cache', async () => {
    const load = vi.fn().mockResolvedValue({ id: 1 });

    expect(await cache.wrap('user:1', 60, load)).toEqual({ id: 1 });
    expect(await cache.wrap('user:1', 60, load)).toEqual({ id: 1 });

    expect(load).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('user:1', JSON.stringify({ id: 1 }), 'EX', 60);
  });

  it('wrap runs the loader once for concurrent misses', async () => {
    const load = vi.fn().mockResolvedValue('value');

    await Promise.all([
      cache.wrap('concurrent', 60, load),
      cache.wrap('concurrent', 60, load),
      cache.wrap('concurrent', 60, load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache null results', async () => {
    const load = vi.fn().mockResolvedValue(null);

    await cache.wrap('missing', 60, load);
    await cache.wrap('missing', 60, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to the loader when Redis fails', async () => {
    redis.get.mockRejectedValueOnce(new Error('connection lost'));

    expect(await cache.wrap('fallback', 60, async () => 'fresh')).toBe('fresh');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'cache.get.failed', key: 'fallback' }),
    );
  });

  it('del reports failure instead of throwing', async () => {
    redis.del.mockRejectedValueOnce(new Error('connection lost'));

    await expect(cache.del('gone')).resolves.toBe(false);
  });
});
