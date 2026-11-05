import compression from 'compression';
import cors from 'cors';
import express, { json, urlencoded } from 'express';
import helmet from 'helmet';
import { config } from '../../config/index.js';
import { httpLogger, logger } from '../../lib/logger.js';
import { createErrorHandler, notFoundHandler } from '../middleware/error-handler.js';
import { rateLimiterMiddleware } from '../middleware/rate-limiter.js';
import { contextMiddleware } from '../middleware/request-context.js';
import { initI18n } from './i18n.js';

import healthRoutes from '../../modules/health/health.routes.js';
import userRoutes from '../../modules/user/user.routes.js';

export const initExpress = async () => {
  const app = express();

  const i18nMiddleware = await initI18n();

  app.enable('trust proxy');

  // First, so every later log line (including body parsing failures) carries the trace id
  app.use(contextMiddleware);
  app.use(httpLogger);

  app.use(helmet());
  app.use(cors());
  app.use(json());
  app.use(urlencoded({ extended: true }));
  app.use(compression());
  app.use(i18nMiddleware);

  app.use(express.static('public'));
  app.use('/uploads', express.static('uploads'));
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(rateLimiterMiddleware);

  app.use(healthRoutes);

  app.use('/api/v1', userRoutes);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, nodeEnv: config.NODE_ENV }));

  return app;
};
