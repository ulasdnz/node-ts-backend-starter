import { config } from './config/index.js';
import { initLoaders } from './core/loaders/index.js';
import { initJobs, shutdownJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { closeRedis } from './lib/redis.js';
import { disconnectDB } from './utils/db.js';

const startServer = async (): Promise<void> => {
  try {
    const app = await initLoaders();

    await initJobs();

    const server = app.listen(config.PORT, () => {
      logger.info(`Server running on port ${config.PORT}`);
    });

    // Graceful shutdown function
    const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);

      server.close(async () => {
        logger.info('Http Server closed');

        try {
          await shutdownJobs();
          logger.info('Jobs/Workers shut down');
          await Promise.all([disconnectDB(), closeRedis()]);
          logger.info('Data connections (Mongo & Redis) closed');

          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown cleanup', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason: unknown) => {
  if (reason instanceof Error) {
    logger.error('Unhandled Promise Rejection:', reason.message, reason.stack);
  } else {
    logger.error('Unhandled Promise Rejection:', reason);
  }
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error.message, error.stack);
  process.exit(1);
});

startServer();
