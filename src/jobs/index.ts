import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { PURGE_QUEUE, type PurgeJobData, scheduleDailyPurgeScan } from './cleanup/purge.queue.js';
import { purgeProcessor } from './cleanup/purge.worker.js';
import { closeJobQueues, createWorker } from './queue-factory.js';

export interface InitJobsOptions {
  /** Off on instances that only serve HTTP; they still enqueue jobs for the workers elsewhere. */
  workersEnabled?: boolean;
}

/** Starts this instance's workers and the schedules they own. Enqueueing needs no setup. */
export const initJobs = async ({
  workersEnabled = config.WORKERS_ENABLED,
}: InitJobsOptions = {}): Promise<void> => {
  if (!workersEnabled) {
    logger.info('Workers are disabled on this instance', { event: 'jobs.workers.disabled' });
    return;
  }

  createWorker<PurgeJobData>(PURGE_QUEUE, purgeProcessor, { concurrency: 5 });
  await scheduleDailyPurgeScan();

  logger.info('Workers started', { event: 'jobs.workers.started', queues: [PURGE_QUEUE] });
};

export const closeJobs = closeJobQueues;
