import fs from 'fs';
import morgan from 'morgan';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config/index.js';
import { getContext } from '../core/middleware/request-context.js';

const logDir = path.join(process.cwd(), 'logs');
if (config.NODE_ENV === 'production') {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
}

const contextFormat = winston.format((info) => {
  const ctx = getContext();
  if (ctx) {
    info.traceId = ctx.traceId;
    info.ip = ctx.ip;
  }
  return info;
});

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.printf((info) => {
    const { level, message, timestamp, traceId, stack } = info;

    const errorStack = typeof stack === 'string' ? stack.split('\n')[0] : stack;
    const logMessage = errorStack || message || 'No message provided';

    return `[${timestamp}] ${level} [traceId=${traceId || 'no-trace'}] ${logMessage}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, traceId, ip, stack, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      statusCode: meta.statusCode,
      method: meta.method,
      path: meta.path,
      traceId,
      ip,
      ...meta,
      stack,
    });
  }),
);

const dailyRotateFile = new DailyRotateFile({
  dirname: logDir,
  level: 'info',
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  utc: true,
  format: winston.format.combine(contextFormat(), fileFormat),
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(contextFormat(), consoleFormat),
  }),
];

if (config.NODE_ENV === 'production') {
  transports.push(dailyRotateFile);
}

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports,
});

export const morganMiddleware = morgan(
  (tokens, req, res) =>
    `${tokens.method(req, res)} ${tokens.url(req, res)} ${tokens.status(
      req,
      res,
    )} - ${tokens['response-time'](req, res)} ms`,
  {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  },
);
