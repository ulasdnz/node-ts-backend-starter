import { Redis, type RedisOptions } from 'ioredis';
import { config } from '../config/index.js';
import { withTimeout } from '../utils/timeout.js';
import { logger } from './logger.js';

/**
 * What a connection is used for decides how it behaves while Redis is unreachable:
 * - `default`: the request path (cache, rate limiting, probes). Commands fail at once instead of
 *   queueing, so a Redis outage degrades requests rather than hanging them.
 * - `bullmq-producer`: enqueueing jobs. Also fails fast, so the caller can report the failure.
 * - `bullmq-worker`: BullMQ's blocking connections, which must retry forever (a BullMQ requirement).
 */
export type RedisRole = 'default' | 'bullmq-producer' | 'bullmq-worker';

const ROLE_OPTIONS: Record<RedisRole, RedisOptions> = {
  default: { enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 1000 },
  'bullmq-producer': { enableOfflineQueue: false },
  'bullmq-worker': { enableOfflineQueue: true, maxRetriesPerRequest: null },
};

export const buildRedisOptions = (role: RedisRole): RedisOptions => ({
  // Creating a client never opens a connection; connecting happens at startup, not at import
  lazyConnect: true,
  connectTimeout: 10_000,
  keepAlive: 10_000,
  // A failover can leave the connection on a read-only replica; reconnecting reaches the primary
  reconnectOnError: (error) => error.message.includes('READONLY'),
  ...ROLE_OPTIONS[role],
});

const clients = new Set<Redis>();

/** Creates a client and registers it, so shutdown closes every connection the app opened. */
export const createRedisClient = (name: string, role: RedisRole = 'default'): Redis => {
  const client = new Redis(config.REDIS_URL, {
    ...buildRedisOptions(role),
    retryStrategy: (attempt) => {
      if (attempt === 1) {
        logger.warn('Redis client reconnecting', {
          event: 'redis.client.reconnecting',
          client: name,
          attempt,
        });
      } else if (attempt % 10 === 0) {
        logger.error('Redis client still reconnecting', {
          event: 'redis.client.reconnecting',
          client: name,
          attempt,
        });
      }
      return Math.min(attempt * 100, 2000);
    },
  });

  client.on('error', (error: Error) => {
    logger.error('Redis client error', {
      event: 'redis.client.error',
      client: name,
      error: error.message,
    });
  });
  client.on('ready', () => {
    logger.info('Redis client ready', { event: 'redis.client.ready', client: name });
  });

  clients.add(client);
  return client;
};

/** Shared request-path client: cache, rate limiting and health probes. */
export const redisClient = createRedisClient('main');

/** Connects the shared client; fails startup instead of retrying forever when Redis is absent. */
export const connectRedis = async (timeoutMs = 10_000): Promise<void> => {
  await withTimeout(
    (async () => {
      await redisClient.connect();
      await redisClient.ping();
    })(),
    timeoutMs,
    'Redis connection',
  );
};

export const closeRedisClients = async (): Promise<void> => {
  await Promise.allSettled(
    [...clients].map(async (client) => {
      if (client.status === 'wait' || client.status === 'end') {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
};
