import { Queue, QueueEvents } from 'bullmq';
import { logger } from '../lib/logger.js';
import { createRedisClient } from '../lib/redis.js';

export const purgeQueue = new Queue('user-purge', {
  connection: createRedisClient(),
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 60_000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export async function setupRepeatedJobs() {
  await purgeQueue.upsertJobScheduler(
    'scan-users-daily',
    {
      pattern: '0 0 * * *', // Every day at midnight
      utc: true,
    },
    {
      name: 'scan-users',
      data: {},
      opts: {},
    },
  );
  logger.info('Repeated jobs set up: scan-users (daily) using JobScheduler');
}

const queueEvents = new QueueEvents('user-purge', {
  connection: createRedisClient(),
});

queueEvents.on('failed', async ({ jobId, failedReason }) => {
  // jobId format: "purge-user-USER_ID" or "scan-users-daily"
  const parts = jobId.split('-');

  if (parts.length > 2 && parts[0] === 'purge' && parts[1] === 'user') {
    const userId = parts.pop();
    logger.error(`🚨 CRITICAL: User purge failed completely!`, {
      userId,
      jobId,
      reason: failedReason,
    });
  } else {
    logger.error(`Job failed: ${jobId}`, { reason: failedReason });
  }
});

queueEvents.on('error', (error) => {
  logger.error('Redis connection error in user-purge queue:', error);
});
