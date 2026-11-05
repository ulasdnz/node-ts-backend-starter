import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { initExpress, resolveCorsOrigin } from '../express.js';

vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const redisClient = createRedisMock();
  // Not ready: the rate limiter deliberately falls back to its in-memory limit
  redisClient.status = 'end';
  return { redisClient, createRedisClient: () => redisClient };
});

setupTestDatabase();

let app: Express;

beforeAll(async () => {
  app = await initExpress();
});

describe('initExpress', () => {
  it('answers malformed JSON on an API route with a JSON 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('error.invalid_json');
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('error.route_not_found');
  });

  it('does not rate limit health checks', async () => {
    const health = await request(app).get('/health/live');
    const api = await request(app).post('/api/v1/auth/login').send({});

    expect(health.headers['ratelimit-limit']).toBeUndefined();
    expect(api.headers['ratelimit-limit']).toBeDefined();
  });
});

describe('resolveCorsOrigin', () => {
  it('allows any origin in development when none are configured', () => {
    expect(resolveCorsOrigin([], 'development')).toBe(true);
  });

  it('allows no cross-origin requests in production when none are configured', () => {
    expect(resolveCorsOrigin([], 'production')).toBe(false);
  });

  it('allows exactly the configured origins', () => {
    expect(resolveCorsOrigin(['https://a.com'], 'production')).toEqual(['https://a.com']);
  });
});
