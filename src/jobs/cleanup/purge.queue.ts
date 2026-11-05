import { config } from '../../config/index.js';
import { getQueue, type TracedJobData, withTraceId } from '../queue-factory.js';

export const PURGE_QUEUE = 'user-purge';

export type PurgeJobName = 'purge-user' | 'scan-users';

export interface PurgeJobData extends TracedJobData {
  /** Set on purge-user jobs; the scan job has none. */
  userId?: string;
}

const purgeQueue = () => getQueue<PurgeJobData>(PURGE_QUEUE);

export const purgeJobId = (userId: string): string => `purge-user-${userId}`;

/**
 * Hard deletes a soft-deleted user once the retention period has passed. A job id is used once,
 * so any earlier job for the user (a delete, then a restore, then a delete again) is removed first.
 */
export const schedulePurge = async (userId: string): Promise<void> => {
  const queue = purgeQueue();
  await queue.remove(purgeJobId(userId));
  await queue.add('purge-user', withTraceId({ userId }), {
    jobId: purgeJobId(userId),
    delay: config.USER_DELETION_RETENTION_MS,
  });
};

/** Removes the user's pending purge; the purge also re-checks the user before deleting anything. */
export const cancelPurge = async (userId: string): Promise<void> => {
  await purgeQueue().remove(purgeJobId(userId));
};

/** A daily scan catches users whose purge job was lost, for example with a Redis outage. */
export const scheduleDailyPurgeScan = async (): Promise<void> => {
  await purgeQueue().upsertJobScheduler(
    'scan-users-daily',
    { pattern: '0 0 * * *', utc: true },
    { name: 'scan-users', data: {} },
  );
};
