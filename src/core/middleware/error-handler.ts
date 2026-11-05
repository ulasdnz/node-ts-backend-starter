import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import i18next, { type TFunction } from 'i18next';
import mongoose from 'mongoose';
import type { Logger } from 'winston';
import { ZodError } from 'zod';
import type { Config } from '../../config/index.js';
import { CustomError, RateLimitError } from '../errors/index.js';
import { routePatternOf } from '../route-pattern.js';
import type { ErrorDetail, ErrorResponse } from '../types/api.types.js';
import type { MongoError } from '../types/mongo.types.js';
import { getTraceId } from './request-context.js';

export interface ErrorHandlerOptions {
  logger: Logger;
  nodeEnv: Config['NODE_ENV'];
}

interface ClassifiedError {
  statusCode: number;
  code: string;
  params?: Record<string, unknown>;
  details?: ErrorDetail[];
  /** Zod messages are i18n keys; Mongoose validator messages are plain text. */
  translateDetails?: boolean;
}

const SUPPORTED_LANGUAGES = ['en', 'tr'];
// Auth failures and throttling are worth seeing in production logs; other 4xx are client noise
const SECURITY_RELEVANT_STATUSES = new Set([401, 403, 429]);

const isHttpStatus = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;

// Errors that carry an HTTP status of their own, such as body-parser's
const classifyHttpError = (err: object): ClassifiedError | undefined => {
  const { status, statusCode, type } = err as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  const httpStatus = isHttpStatus(statusCode)
    ? statusCode
    : isHttpStatus(status)
      ? status
      : undefined;
  if (httpStatus === undefined || httpStatus >= 500) return undefined;

  if (type === 'entity.parse.failed') return { statusCode: 400, code: 'error.invalid_json' };
  if (type === 'entity.too.large') return { statusCode: 413, code: 'error.payload_too_large' };
  return { statusCode: httpStatus, code: 'error.bad_request' };
};

/** Maps a known error to its response; `undefined` means unexpected, which becomes a 500. */
const classify = (err: unknown): ClassifiedError | undefined => {
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'error.validation_failed',
      translateDetails: true,
      details: err.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => ({ field: key, message: 'validation.field_not_allowed' }))
          : [{ field: issue.path.join('.'), message: issue.message }],
      ),
    };
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 400,
      code: 'error.validation_failed',
      details: Object.values(err.errors).map((error) => ({
        field: error.path,
        message: error.message,
      })),
    };
  }

  if (err instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      code: 'error.invalid_id',
      translateDetails: true,
      details: [{ field: err.path, message: 'error.invalid_id' }],
    };
  }

  if (err instanceof CustomError) {
    return {
      statusCode: isHttpStatus(err.statusCode) ? err.statusCode : 500,
      code: err.message,
      params: err.details,
    };
  }

  if (typeof err !== 'object' || err === null) return undefined;

  if ((err as MongoError).code === 11000) {
    const { keyValue, keyPattern } = err as MongoError;
    const field = Object.keys(keyValue ?? keyPattern ?? {})[0] ?? 'field';
    return { statusCode: 409, code: 'error.duplicate_entry', params: { field } };
  }

  return classifyHttpError(err);
};

// Errors raised before the i18n middleware (a malformed JSON body, for one) still get a message in
// the client's language
const translatorFor = (req: Request): TFunction =>
  typeof req.t === 'function'
    ? req.t
    : i18next.getFixedT(req.acceptsLanguages(...SUPPORTED_LANGUAGES) || 'en');

export const createErrorHandler =
  ({ logger, nodeEnv }: ErrorHandlerOptions): ErrorRequestHandler =>
  (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    // A response already on the wire cannot become an error response; Express closes it instead
    if (res.headersSent) {
      next(err);
      return;
    }

    const classified = classify(err);
    const statusCode = classified?.statusCode ?? 500;
    const code = classified?.code ?? 'error.unexpected';
    const stack = err instanceof Error ? err.stack : undefined;
    const requestMeta = { statusCode, method: req.method, route: routePatternOf(req, res) };

    if (statusCode >= 500) {
      logger.error('Request failed with an unexpected error', {
        event: 'http.error.unexpected',
        ...requestMeta,
        error: err instanceof Error ? err.message : String(err),
        stack,
      });
    } else if (SECURITY_RELEVANT_STATUSES.has(statusCode)) {
      logger.warn('Request rejected', { event: 'http.error.client', ...requestMeta, code });
    } else {
      logger.debug('Request rejected', { event: 'http.error.client', ...requestMeta, code });
    }

    if (err instanceof RateLimitError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
    }

    // The message is sent as JSON text; escaping it for HTML is the renderer's job
    const t = translatorFor(req);
    const interpolation = { escapeValue: false };
    const body: ErrorResponse = {
      error: {
        code,
        message: t(code, { ...classified?.params, interpolation }),
        traceId: getTraceId(),
      },
    };

    if (classified?.details) {
      body.error.details = classified.details.map(({ field, message }) => ({
        field,
        message: classified.translateDetails ? t(message, { interpolation }) : message,
      }));
    }
    if (nodeEnv === 'development' && stack) {
      body.error.stack = stack;
    }

    res.status(statusCode).json(body);
  };

/** Last regular middleware: anything that reaches it matched no route. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new CustomError(404, 'error.route_not_found'));
};
