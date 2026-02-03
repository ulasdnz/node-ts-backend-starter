import { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { createRedisClient } from '../lib/redis.js';
import purgeProcessor from './cleanup/purge.worker.js';

const workers: Worker[] = [];

export function initWorkers() {
  logger.info('Initializing BullMQ workers...');

  const purgeWorker = new Worker('user-purge', purgeProcessor, {
    connection: createRedisClient(),
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 10000,
    },
  });

  purgeWorker.on('failed', (job, err) => {
    const metadata = {
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts,
      queueName: job?.queueName,
      userId: job?.data?.userId,
    };

    logger.error(`Job ${job?.id} failed in queue ${job?.queueName}:`, {
      error: err.message,
      ...metadata,
    });

    if (job && job.attemptsMade >= (job.opts.attempts || 0)) {
      logger.error(`🚨 CRITICAL: Job completely failed after all retries`, {
        ...metadata,
        stack: err.stack,
      });
    }
  });

  purgeWorker.on('error', (err) => {
    logger.error(`Worker error in queue user-purge:`, err);
  });

  workers.push(purgeWorker);

  logger.info(`Initialized ${workers.length} workers.`);
}

export async function shutdownWorkers() {
  logger.info('Shutting down BullMQ workers...');

  await Promise.all(
    workers.map((worker) =>
      worker.close().catch((err) => {
        logger.error(`Failed to close worker ${worker.name}:`, err);
      }),
    ),
  );

  logger.info('All workers shut down.');
}
