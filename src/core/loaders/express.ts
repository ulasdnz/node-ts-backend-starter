import compression from 'compression';
import cors from 'cors';
import express, { json, Router, urlencoded, type Express } from 'express';
import helmet from 'helmet';
import { config, type Config } from '../../config/index.js';
import { httpLogger, logger } from '../../lib/logger.js';
import { redisClient } from '../../lib/redis.js';
import { UPLOADS_DIRECTORY } from '../../lib/storage.js';
import { mongoProbe, redisProbe } from '../../modules/health/health.probes.js';
import { createHealthRouter } from '../../modules/health/health.routes.js';
import userRoutes from '../../modules/user/user.routes.js';
import { createErrorHandler, notFoundHandler } from '../middleware/error-handler.js';
import { createRateLimiter } from '../middleware/rate-limiter.js';
import { contextMiddleware } from '../middleware/request-context.js';
import { isShuttingDown } from '../shutdown.js';
import { initI18n } from './i18n.js';

const BODY_LIMIT = '100kb';

/**
 * CORS policy: the configured origins only. With none configured, any origin is allowed in
 * development for convenience and none elsewhere. Native mobile clients send no Origin header and
 * are unaffected either way.
 */
export const resolveCorsOrigin = (
  origins: string[],
  nodeEnv: Config['NODE_ENV'],
): boolean | string[] => (origins.length > 0 ? origins : nodeEnv === 'development');

export const initExpress = async (): Promise<Express> => {
  const app = express();
  const i18nMiddleware = await initI18n();

  // How many proxies may append to X-Forwarded-For; it decides req.ip, and so the rate-limit key
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.disable('etag');

  // First, so every later log line (including body parsing failures) carries the trace id
  app.use(contextMiddleware);
  app.use(httpLogger);

  app.use(helmet());
  app.use(cors({ origin: resolveCorsOrigin(config.CORS_ORIGINS, config.NODE_ENV) }));
  app.use(compression());
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(i18nMiddleware);

  // Infrastructure endpoints sit outside /api, so probes are never rate limited
  app.use(
    createHealthRouter({
      probes: [mongoProbe(), redisProbe(redisClient)],
      logger,
      isShuttingDown,
    }),
  );
  app.use('/uploads', express.static(UPLOADS_DIRECTORY, { index: false }));

  const api = Router();
  api.use(
    createRateLimiter({
      keyPrefix: 'rl:api',
      points: config.RATE_LIMIT_POINTS,
      durationSeconds: config.RATE_LIMIT_DURATION_SECONDS,
      storeClient: redisClient,
    }),
  );
  api.use('/v1', userRoutes);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, nodeEnv: config.NODE_ENV }));

  return app;
};
