import express from 'express';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { createErrorHandler } from '../error-handler.js';
import { createRateLimiter, type RateLimiterOptions } from '../rate-limiter.js';

const buildApp = (options: RateLimiterOptions) => {
  const app = express();
  app.use(createRateLimiter(options));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(
    createErrorHandler({
      logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
      nodeEnv: 'test',
    }),
  );
  return app;
};

// Nothing listens on port 1: this client can never become ready
const unreachableRedis = new Redis({
  port: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
unreachableRedis.on('error', () => {});

afterAll(() => {
  unreachableRedis.disconnect();
});

describe('createRateLimiter', () => {
  it('allows requests within the limit and reports the remaining budget', async () => {
    const app = buildApp({ keyPrefix: 'rl:test-budget', points: 2, durationSeconds: 60 });

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');
    expect(second.headers['ratelimit-remaining']).toBe('0');
    expect(Number(first.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('rejects the request over the limit with 429 and Retry-After', async () => {
    const app = buildApp({ keyPrefix: 'rl:test-over', points: 1, durationSeconds: 60 });
    await request(app).get('/ping');

    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('error.rate_limit_exceeded');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('keeps serving from memory when the Redis store fails', async () => {
    const app = buildApp({
      keyPrefix: 'rl:test-insurance',
      points: 2,
      durationSeconds: 60,
      storeClient: unreachableRedis,
    });

    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(429);
  });
});
