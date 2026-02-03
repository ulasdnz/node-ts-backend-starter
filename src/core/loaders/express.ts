import compression from 'compression';
import cors from 'cors';
import express, { json, urlencoded } from 'express';
import helmet from 'helmet';
import { morganMiddleware } from '../../lib/logger.js';
import { errorHandler } from '../middleware/error-handler.js';
import { rateLimiterMiddleware } from '../middleware/rate-limiter.js';
import { contextMiddleware } from '../middleware/request-context.js';
import { initI18n } from './i18n.js';

import healthRoutes from '../../modules/health/health.routes.js';
import userRoutes from '../../modules/user/user.routes.js';

export const initExpress = async () => {
  const app = express();

  const i18nMiddleware = await initI18n();

  app.enable('trust proxy');
  app.use(helmet());
  app.use(cors());
  app.use(json());
  app.use(urlencoded({ extended: true }));
  app.use(compression());
  app.use(i18nMiddleware);

  app.use(contextMiddleware);
  app.use(morganMiddleware);
  app.use(express.static('public'));
  app.use('/uploads', express.static('uploads'));
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(rateLimiterMiddleware);

  app.use(healthRoutes);

  app.use('/api/v1', userRoutes);

  app.use(errorHandler);

  return app;
};
