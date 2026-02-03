import { logger } from '../lib/logger.js';
import { setupRepeatedJobs } from './queues.js';
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

export { shutdownWorkers as shutdownJobs };
