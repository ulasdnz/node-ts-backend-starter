import { logger } from '../lib/logger.js';
import { closeQueues, setupRepeatedJobs } from './queues.js';
import { initWorkers, shutdownWorkers } from './workers.js';

export async function initJobs() {
  try {
    initWorkers();
    await setupRepeatedJobs();
    logger.info('Background jobs initialized successfully.');
  } catch (error) {
    logger.error('Failed to initialize background jobs:', error);
  }
}

/** Workers stop first, finishing their active jobs, then the queues they read from close. */
export async function closeJobs(): Promise<void> {
  await shutdownWorkers();
  await closeQueues();
}
