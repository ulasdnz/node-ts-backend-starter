import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { expectDocumentedResponse } from '../../../test/helpers/openapi.js';
import { redisProbe, type HealthProbe } from '../health.probes.js';
import { createHealthRouter } from '../health.routes.js';

const probe = (name: string, healthy = true): HealthProbe => ({
  name,
  check: vi.fn(async () => {
    if (!healthy) throw new Error(`${name} is down`);
  }),
});

const buildApp = (probes: HealthProbe[], shuttingDown = false) => {
  const logger = { warn: vi.fn() };
  const app = express();
  app.use(
    createHealthRouter({
      probes,
      logger: logger,
      isShuttingDown: () => shuttingDown,
    }),
  );
  return { app, logger };
};

// Every response is also checked against the OpenAPI document
const get = async (app: express.Express, path: '/health' | '/health/ready' | '/health/live') => {
  const res = await request(app).get(path);
  expectDocumentedResponse(res, 'get', path);
  return res;
};

describe('health routes', () => {
  it('live stays 200 while shutting down', async () => {
    const res = await get(buildApp([], true).app, '/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alive: true });
  });

  it('ready is 503 while shutting down without running probes', async () => {
    const mongo = probe('mongodb');

    const res = await get(buildApp([mongo], true).app, '/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
    expect(mongo.check).not.toHaveBeenCalled();
  });

  it('ready is 503 and logs when a probe fails', async () => {
    const { app, logger } = buildApp([probe('mongodb'), probe('redis', false)]);

    const res = await get(app, '/health/ready');

    expect(res.status).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'health.probe.failed', probe: 'redis' }),
    );
  });

  it('ready is 200 when every probe passes', async () => {
    const res = await get(buildApp([probe('mongodb'), probe('redis')]).app, '/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it('health reports each service and fails as a whole', async () => {
    const res = await get(buildApp([probe('mongodb', false), probe('redis')]).app, '/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'unhealthy',
      services: { mongodb: 'unhealthy', redis: 'healthy' },
    });
  });

  it('a probe that hangs counts as unhealthy', async () => {
    const hanging = redisProbe({ ping: () => new Promise<'PONG'>(() => {}) }, 50);

    const res = await get(buildApp([hanging]).app, '/health');

    expect(res.body.services).toEqual({ redis: 'unhealthy' });
  });

  it('ready stays 200 when only a non-critical probe fails', async () => {
    const cache = { ...probe('redis', false), critical: false };

    const res = await get(buildApp([probe('mongodb'), cache]).app, '/health/ready');

    expect(res.status).toBe(200);
  });

  it('health reports degraded service when only a non-critical probe fails', async () => {
    const cache = { ...probe('redis', false), critical: false };

    const res = await get(buildApp([probe('mongodb'), cache]).app, '/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'degraded',
      services: { mongodb: 'healthy', redis: 'unhealthy' },
    });
  });

  it('treats Redis as a dependency the API can run without', () => {
    expect(redisProbe({ ping: () => Promise.resolve('PONG' as const) }).critical).toBe(false);
  });
});
