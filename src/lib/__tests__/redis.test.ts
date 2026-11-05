import { describe, expect, it } from 'vitest';
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
});
