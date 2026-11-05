import express, { json, type Request, type RequestHandler, type Response } from 'express';
import i18next from 'i18next';
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { z } from 'zod';
import { CustomError, RateLimitError } from '../../errors/index.js';
import { initI18n } from '../../loaders/i18n.js';
import { createErrorHandler, notFoundHandler } from '../error-handler.js';
import { contextMiddleware } from '../request-context.js';

const createFakeLogger = () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  http: vi.fn(),
  debug: vi.fn(),
});
type FakeLogger = ReturnType<typeof createFakeLogger>;

let i18nMiddleware: RequestHandler;

beforeAll(async () => {
  i18nMiddleware = await initI18n();
});

// Same order as the real app: body parsing runs before i18n, so parse errors skip i18n entirely
const buildApp = (
  options: {
    nodeEnv?: 'production' | 'development';
    logger?: FakeLogger;
    route?: RequestHandler;
  } = {},
) => {
  const logger = options.logger ?? createFakeLogger();
  const app = express();
  app.use(contextMiddleware);
  app.use(json({ limit: '1kb' }));
  app.use(i18nMiddleware);
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  if (options.route) app.all('/fail', options.route);
  app.use(notFoundHandler);
  app.use(
    createErrorHandler({
      logger: logger as unknown as Logger,
      nodeEnv: options.nodeEnv ?? 'production',
    }),
  );
  return { app, logger };
};

const failingWith =
  (error: unknown): RequestHandler =>
  () => {
    throw error;
  };

describe('createErrorHandler', () => {
  it('maps ZodError to 400 with translated field details', async () => {
    const schema = z.object({ email: z.email({ message: 'validation.email_invalid' }) }).strict();
    const { app } = buildApp({
      route: (req) => {
        schema.parse(req.body);
      },
    });

    const res = await request(app).post('/fail').send({ email: 'x', extra: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('error.validation_failed');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'email', message: 'Invalid email format' },
        { field: 'extra', message: 'Field is not allowed.' },
      ]),
    );
  });

  it('translates CustomError by Accept-Language', async () => {
    const { app } = buildApp({ route: failingWith(new CustomError(404, 'user.not_found')) });

    const res = await request(app).get('/fail').set('Accept-Language', 'tr');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('user.not_found');
    expect(res.body.error.message).toBe(i18next.t('user.not_found', { lng: 'tr' }));
    expect(res.body.error.message).not.toBe('user.not_found');
  });

  it('answers malformed JSON with 400 error.invalid_json although i18n has not run', async () => {
    const res = await request(buildApp().app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toMatchObject({
      code: 'error.invalid_json',
      message: 'Request body is not valid JSON.',
    });
  });

  it('translates errors raised before i18n by Accept-Language', async () => {
    const res = await request(buildApp().app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .set('Accept-Language', 'tr')
      .send('{"a":');

    expect(res.body.error.message).toBe(i18next.t('error.invalid_json', { lng: 'tr' }));
    expect(res.body.error.message).not.toBe('Request body is not valid JSON.');
  });

  it('answers oversized bodies with 413 error.payload_too_large', async () => {
    const res = await request(buildApp().app)
      .post('/echo')
      .send({ data: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('error.payload_too_large');
  });

  it('maps duplicate keys to 409 with the field', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyValue: { email: 'a@b.c' },
    });

    const res = await request(buildApp({ route: failingWith(duplicate) }).app).get('/fail');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('error.duplicate_entry');
    expect(res.body.error.message).toContain('email');
  });

  it('maps CastError to 400 error.invalid_id', async () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');

    const res = await request(buildApp({ route: failingWith(castError) }).app).get('/fail');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('error.invalid_id');
  });

  it('maps mongoose ValidationError to 400 with field details', async () => {
    const Model = mongoose.model(
      'ErrorHandlerValidation',
      new mongoose.Schema({ name: { type: String, required: true } }),
    );
    const validationError = new Model({}).validateSync();

    const res = await request(buildApp({ route: failingWith(validationError) }).app).get('/fail');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('error.validation_failed');
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'name' })]);
  });

  it('hides unexpected errors behind 500 and logs the stack', async () => {
    const { app, logger } = buildApp({ route: failingWith(new Error('db exploded')) });

    const res = await request(app).get('/fail');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('error.unexpected');
    expect(res.body.error.message).not.toContain('db exploded');
    expect(res.body.error.stack).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'http.error.unexpected',
        stack: expect.stringContaining('db exploded'),
      }),
    );
  });

  it('includes the stack only in development', async () => {
    const { app } = buildApp({
      nodeEnv: 'development',
      route: failingWith(new Error('db exploded')),
    });

    const res = await request(app).get('/fail');

    expect(res.body.error.stack).toContain('db exploded');
  });

  it('sets Retry-After for RateLimitError', async () => {
    const res = await request(buildApp({ route: failingWith(new RateLimitError(30)) }).app).get(
      '/fail',
    );

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body.error.code).toBe('error.rate_limit_exceeded');
  });

  it('logs 401, 403 and 429 at warn and other 4xx at debug', async () => {
    for (const status of [401, 403, 429]) {
      const logger = createFakeLogger();
      await request(
        buildApp({ logger, route: failingWith(new CustomError(status, 'auth.forbidden')) }).app,
      ).get('/fail');
      expect(logger.warn, String(status)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ event: 'http.error.client', statusCode: status }),
      );
    }

    const logger = createFakeLogger();
    await request(
      buildApp({ logger, route: failingWith(new CustomError(404, 'user.not_found')) }).app,
    ).get('/fail');
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns the request trace id in the error body', async () => {
    const res = await request(
      buildApp({ route: failingWith(new CustomError(400, 'error.bad_request')) }).app,
    )
      .get('/fail')
      .set('X-Trace-Id', 'trace-abc-123');

    expect(res.body.error.traceId).toBe('trace-abc-123');
  });

  it('answers unknown routes with a JSON 404 error.route_not_found', async () => {
    const res = await request(buildApp().app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('error.route_not_found');
  });

  it('delegates to Express when headers were already sent', () => {
    const handler = createErrorHandler({
      logger: createFakeLogger() as unknown as Logger,
      nodeEnv: 'production',
    });
    const next = vi.fn();
    const error = new Error('late');
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() } as unknown as Response;

    handler(error, {} as Request, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
