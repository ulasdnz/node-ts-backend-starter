import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../utils/timeout.js';
import { buildRedisOptions, closeRedisClients, createRedisClient } from '../redis.js';

describe('buildRedisOptions', () => {
  it('fails fast on the request path', () => {
    expect(buildRedisOptions('default')).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
    });
  });

  it('lets BullMQ workers block', () => {
    expect(buildRedisOptions('bullmq-worker')).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
    });
  });

  it('fails fast when producing jobs', () => {
    const options = buildRedisOptions('bullmq-producer');

    expect(options).toMatchObject({ lazyConnect: true, enableOfflineQueue: false });
    expect(options).not.toHaveProperty('maxRetriesPerRequest');
  });
});

describe('closeRedisClients', () => {
  it('closes every client it created, including ones that never connected', async () => {
    const clients = [createRedisClient('first'), createRedisClient('second', 'bullmq-worker')];

    await closeRedisClients();

    expect(clients.map((client) => client.status)).toEqual(['end', 'end']);
  });

  it('does not hang on a client that is still trying to reach Redis', async () => {
    // The test REDIS_URL points at a port nothing listens on
    const client = createRedisClient('unreachable', 'bullmq-worker');
    const reconnects = vi.fn();
    client.on('reconnecting', reconnects);
    client.connect().catch(() => {});
    await vi.waitFor(() => expect(reconnects).toHaveBeenCalled(), { timeout: 10_000 });
    // Queued until Redis comes back, which it never does
    client.get('queued').catch(() => {});

    await expect(withTimeout(closeRedisClients(), 3000, 'closeRedisClients')).resolves.toBe(
      undefined,
    );

    // Closed for good: no reconnect attempt follows, well past the next retry delay
    const attemptsAtClose = reconnects.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(reconnects).toHaveBeenCalledTimes(attemptsAtClose);
  });
});
