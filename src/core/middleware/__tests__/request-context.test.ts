import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  contextMiddleware,
  getContext,
  getTraceId,
  setUserId,
  type RequestContext,
} from '../request-context.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const buildApp = () => {
  const app = express();
  app.use(contextMiddleware);
  app.get('/context', (_req, res) => {
    res.json(getContext());
  });
  app.get('/later', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    res.json({ traceId: getTraceId() });
  });
  app.get('/user', (_req, res) => {
    setUserId('user-1');
    res.json(getContext());
  });
  return app;
};

// Node refuses to send or parse some header values, so those cases call the middleware directly
const contextFor = (headers: Record<string, string>): RequestContext | undefined => {
  let captured: RequestContext | undefined;
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    ip: '::1',
  } as unknown as Request;
  const res = { setHeader: vi.fn() } as unknown as Response;

  contextMiddleware(req, res, () => {
    captured = getContext();
  });

  return captured;
};

describe('contextMiddleware', () => {
  it('echoes a valid X-Trace-Id', async () => {
    const res = await request(buildApp()).get('/context').set('X-Trace-Id', 'abc-12345');

    expect(res.headers['x-trace-id']).toBe('abc-12345');
    expect(res.body.traceId).toBe('abc-12345');
  });

  it('uses X-Request-Id when X-Trace-Id is absent', async () => {
    const res = await request(buildApp()).get('/context').set('X-Request-Id', 'req-98765');

    expect(res.body.traceId).toBe('req-98765');
  });

  it('takes the trace id from a W3C traceparent header', async () => {
    const res = await request(buildApp())
      .get('/context')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

    expect(res.body.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('replaces hostile trace ids with a generated UUID', async () => {
    for (const value of ['a'.repeat(129), 'short']) {
      const res = await request(buildApp()).get('/context').set('X-Trace-Id', value);
      expect(res.body.traceId, value).toMatch(UUID_V4);
    }
    for (const value of ['abc\r\nxyz123', 'şşşşşşşşşş']) {
      expect(contextFor({ 'x-trace-id': value })?.traceId, value).toMatch(UUID_V4);
    }
  });

  it('keeps the context across awaits', async () => {
    const res = await request(buildApp()).get('/later').set('X-Trace-Id', 'async-trace-1');

    expect(res.body.traceId).toBe('async-trace-1');
  });

  it('setUserId adds the user to the current context', async () => {
    const res = await request(buildApp()).get('/user');

    expect(res.body.userId).toBe('user-1');
  });
});
