import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { runInContext } from '../../core/middleware/request-context.js';
import { createHttpLogger, createLogger, developmentFormat, productionFormat } from '../logger.js';

type Format = typeof productionFormat;
type LogInfo = { level: string; message: string; [key: string]: unknown };

const MESSAGE = Symbol.for('message');
const LEVEL = Symbol.for('level');

// Runs a winston format the way a transport would and returns the rendered line
const render = (format: Format, info: LogInfo): string => {
  const output = format.transform({ ...info, [LEVEL]: info.level });
  if (!output) throw new Error('format dropped the log entry');
  return (output as unknown as Record<symbol, string>)[MESSAGE] as string;
};

describe('productionFormat', () => {
  it('emits one JSON line with severity and context', () => {
    const line = runInContext({ traceId: 't-1', ip: '::1', userId: 'u1' }, () =>
      render(productionFormat, {
        level: 'warn',
        message: 'Login blocked',
        event: 'auth.login.blocked',
        attempts: 5,
      }),
    );

    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      severity: 'WARNING',
      message: 'Login blocked',
      event: 'auth.login.blocked',
      traceId: 't-1',
      userId: 'u1',
      attempts: 5,
    });
  });

  it('keeps error stacks', () => {
    const line = render(productionFormat, {
      level: 'error',
      message: 'boom',
      stack: 'Error: boom\n    at handler',
    });

    expect(JSON.parse(line).stack).toBe('Error: boom\n    at handler');
  });
});

describe('developmentFormat', () => {
  it('prints the event tag and metadata', () => {
    const line = render(developmentFormat, {
      level: 'info',
      message: 'Login blocked',
      event: 'auth.login.blocked',
      attempts: 5,
    });

    expect(line).toContain('[auth.login.blocked]');
    expect(line).toContain('"attempts":5');
  });
});

describe('createLogger', () => {
  it('is silent in the test environment', () => {
    const logger = createLogger({ level: 'info', nodeEnv: 'test' });

    expect(logger.transports.every((transport) => transport.silent)).toBe(true);
  });
});

describe('createHttpLogger', () => {
  it('records the route pattern, status and duration', async () => {
    const http = vi.fn();
    const router = Router();
    router.get('/items/:id', (_req, res) => {
      res.json({ ok: true });
    });
    const app = express();
    app.use(createHttpLogger({ http } as unknown as Logger));
    app.use('/api', router);

    await request(app).get('/api/items/42?token=secret');

    await vi.waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'HTTP request completed',
        expect.objectContaining({
          event: 'http.request.completed',
          method: 'GET',
          route: '/api/items/:id',
          statusCode: 200,
          durationMs: expect.any(Number),
        }),
      ),
    );
  });

  it('logs unmatched paths without their query string', async () => {
    const http = vi.fn();
    const app = express();
    app.use(createHttpLogger({ http } as unknown as Logger));

    await request(app).get('/missing?token=secret');

    await vi.waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'HTTP request completed',
        expect.objectContaining({ route: '/missing', statusCode: 404 }),
      ),
    );
  });
});
