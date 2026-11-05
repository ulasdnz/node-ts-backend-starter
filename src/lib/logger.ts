import type { NextFunction, Request, RequestHandler, Response } from 'express';
import winston from 'winston';
import { config, type Config } from '../config/index.js';
import { getContext } from '../core/middleware/request-context.js';
import { routePatternOf } from '../core/route-pattern.js';

// Cloud Logging derives a log entry's level from `severity`; winston's own `level` field is ignored
const SEVERITY_BY_LEVEL: Record<string, string> = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  http: 'INFO',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  silly: 'DEBUG',
};

const contextFormat = winston.format((info) => {
  const context = getContext();
  if (context) {
    info.traceId = context.traceId;
    if (context.userId) info.userId = context.userId;
  }
  return info;
});

const severityFormat = winston.format((info) => {
  info.severity = SEVERITY_BY_LEVEL[info.level] ?? 'DEFAULT';
  return info;
});

/** One JSON object per line on stdout, ready for any log collector. */
export const productionFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  contextFormat(),
  winston.format.timestamp(),
  severityFormat(),
  winston.format.json(),
);

/** Human-readable lines that still show every structured field. */
export const developmentFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  contextFormat(),
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf((info) => {
    const { level, message, timestamp, traceId, event, stack, ...meta } = info;
    const eventTag = typeof event === 'string' ? ` [${event}]` : '';
    const trace = typeof traceId === 'string' ? traceId : '-';
    const metaText = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const text = typeof stack === 'string' ? stack : String(message);

    return `[${String(timestamp)}] ${level} [${trace}]${eventTag} ${text}${metaText}`;
  }),
);

export interface LoggerOptions {
  level: string;
  nodeEnv: Config['NODE_ENV'];
}

export const createLogger = ({ level, nodeEnv }: LoggerOptions): winston.Logger =>
  winston.createLogger({
    level,
    format: nodeEnv === 'production' ? productionFormat : developmentFormat,
    transports: [new winston.transports.Console({ silent: nodeEnv === 'test' })],
  });

/**
 * Logs every request once it ends: with the route pattern rather than the raw URL (no ids or query
 * strings in the log, and stable values to aggregate on), the status code and the duration. A request
 * whose client went away before the response was sent is marked `aborted`.
 */
export const createHttpLogger =
  (logger: winston.Logger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    let logged = false;

    const log = (aborted: boolean) => {
      if (logged) return;
      logged = true;

      const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;

      logger.http('HTTP request completed', {
        event: 'http.request.completed',
        method: req.method,
        route: routePatternOf(req),
        statusCode: res.statusCode,
        durationMs,
        ...(aborted && { aborted: true }),
      });
    };

    res.on('finish', () => log(false));
    res.on('close', () => {
      if (!res.writableFinished) log(true);
    });

    next();
  };

export const logger = createLogger({ level: config.LOG_LEVEL, nodeEnv: config.NODE_ENV });
export const httpLogger = createHttpLogger(logger);
