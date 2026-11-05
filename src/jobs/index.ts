import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { PURGE_QUEUE, type PurgeJobData, scheduleDailyPurgeScan } from './cleanup/purge.queue.js';
import { purgeProcessor } from './cleanup/purge.worker.js';
import { closeJobQueues, createWorker, getQueue } from './queue-factory.js';

export interface InitJobsOptions {
  /** Off on instances that only serve HTTP; they still enqueue jobs for the workers elsewhere. */
  workersEnabled?: boolean;
}

/**
 * Connects the queues this instance enqueues into and starts its workers. It runs right after Redis
 * was reached, because a BullMQ queue or worker whose first connection attempt fails stays broken
 * after Redis comes back; once connected, both ride out later outages.
 */
export const initJobs = async ({
  workersEnabled = config.WORKERS_ENABLED,
}: InitJobsOptions = {}): Promise<void> => {
  await getQueue<PurgeJobData>(PURGE_QUEUE).waitUntilReady();

  if (!workersEnabled) {
    logger.info('Workers are disabled on this instance', { event: 'jobs.workers.disabled' });
    return;
  }

  const purgeWorker = createWorker<PurgeJobData>(PURGE_QUEUE, purgeProcessor, { concurrency: 5 });
  await purgeWorker.waitUntilReady();
  await scheduleDailyPurgeScan();

  logger.info('Workers started', { event: 'jobs.workers.started', queues: [PURGE_QUEUE] });
};

export const closeJobs = closeJobQueues;
