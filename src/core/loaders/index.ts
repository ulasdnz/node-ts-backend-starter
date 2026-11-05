import type { Express } from 'express';
import { flushAuditLogs } from '../../database/plugins/audit-log.plugin.js';
import { closeJobs, initJobs } from '../../jobs/index.js';
import { logger } from '../../lib/logger.js';
import { closeRedisClients, connectRedis } from '../../lib/redis.js';
import { disconnectDB } from '../../utils/db.js';
import { onShutdown } from '../shutdown.js';
import { initExpress } from './express.js';
import { initMongoose } from './mongoose.js';

/**
 * Starts every dependency in order. Each teardown is registered before its dependency starts, so a
 * failure halfway through still closes whatever was already opened. Throws on the first failure.
 */
export const initLoaders = async (): Promise<Express> => {
  logger.info('Initializing application', { event: 'app.init.started' });

  onShutdown('mongodb', disconnectDB);
  // Hooks run in reverse order, so pending audit entries are written before MongoDB closes
  onShutdown('audit-log', flushAuditLogs);
  await initMongoose();

  onShutdown('redis', closeRedisClients);
  await connectRedis();

  onShutdown('jobs', closeJobs);
  await initJobs();

  const app = await initExpress();
  logger.info('Application initialized', { event: 'app.init.completed' });
  return app;
};
