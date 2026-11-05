import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
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

describe('health routes', () => {
  it('live stays 200 while shutting down', async () => {
    const res = await request(buildApp([], true).app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alive: true });
  });

  it('ready is 503 while shutting down without running probes', async () => {
    const mongo = probe('mongodb');

    const res = await request(buildApp([mongo], true).app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
    expect(mongo.check).not.toHaveBeenCalled();
  });

  it('ready is 503 and logs when a probe fails', async () => {
    const { app, logger } = buildApp([probe('mongodb'), probe('redis', false)]);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'health.probe.failed', probe: 'redis' }),
    );
  });

  it('ready is 200 when every probe passes', async () => {
    const res = await request(buildApp([probe('mongodb'), probe('redis')]).app).get(
      '/health/ready',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it('health reports each service and fails as a whole', async () => {
    const res = await request(buildApp([probe('mongodb', false), probe('redis')]).app).get(
      '/health',
    );

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'unhealthy',
      services: { mongodb: 'unhealthy', redis: 'healthy' },
    });
  });

  it('a probe that hangs counts as unhealthy', async () => {
    const hanging = redisProbe({ ping: () => new Promise<'PONG'>(() => {}) }, 50);

    const res = await request(buildApp([hanging]).app).get('/health/ready');

    expect(res.status).toBe(503);
  });
});
