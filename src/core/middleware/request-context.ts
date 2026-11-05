import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  traceId: string;
  ip: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Trace ids end up in every log line and response, so a client-supplied one is accepted only when it
// is short and made of characters that cannot break a log line or a header
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const INVALID_TRACEPARENT_ID = '0'.repeat(32);

const traceIdFromTraceparent = (header: string | undefined): string | undefined => {
  const traceId = header ? TRACEPARENT_PATTERN.exec(header)?.[1] : undefined;
  return traceId && traceId !== INVALID_TRACEPARENT_ID ? traceId : undefined;
};

const resolveTraceId = (req: Request): string => {
  const candidate = req.header('x-trace-id') ?? req.header('x-request-id');
  if (candidate && TRACE_ID_PATTERN.test(candidate)) return candidate;

  return traceIdFromTraceparent(req.header('traceparent')) ?? randomUUID();
};

export const contextMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const context: RequestContext = { traceId: resolveTraceId(req), ip: req.ip ?? 'unknown' };

  res.setHeader('X-Trace-Id', context.traceId);
  storage.run(context, () => next());
};

export const getContext = (): RequestContext | undefined => storage.getStore();

export const getTraceId = (): string | undefined => storage.getStore()?.traceId;

/** Records the authenticated user on the current request's context, for logs and audit entries. */
export const setUserId = (userId: string): void => {
  const context = storage.getStore();
  if (context) context.userId = userId;
};

/** Runs work outside an HTTP request (jobs, scripts) under a context of its own. */
export const runInContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);
