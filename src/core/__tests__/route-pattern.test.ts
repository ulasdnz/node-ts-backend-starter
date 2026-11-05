import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { createHttpLogger } from '../../lib/logger.js';
import { CustomError } from '../errors/index.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { createRouter } from '../router.js';

describe('route patterns in logs', () => {
  it('keeps the mount prefix when an error leaves nested routers', async () => {
    const logger = { info: vi.fn(), http: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const v1 = createRouter();
    v1.get('/items/:id', () => {
      throw new CustomError(404, 'error.route_not_found');
    });
    const api = createRouter();
    api.use('/v1', v1);
    const app = express();
    app.use(createHttpLogger(logger as unknown as Logger));
    app.use('/api', api);
    app.use(createErrorHandler({ logger: logger as unknown as Logger, nodeEnv: 'test' }));

    await request(app).get('/api/v1/items/42');

    expect(logger.debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ route: '/api/v1/items/:id' }),
    );
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        'HTTP request completed',
        expect.objectContaining({ route: '/api/v1/items/:id', statusCode: 404 }),
      ),
    );
  });
});
