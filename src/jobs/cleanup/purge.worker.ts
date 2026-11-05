import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import User from '../../modules/user/user.model.js';
import type { PurgeJobData } from './purge.queue.js';
import { scanUsersForPurge } from './purge.scheduler.js';

export type PurgeResult = { scanned: number } | { deleted: boolean; userId: string };

/**
 * Processes the purge queue. A purge-user job hard deletes the user only if it is still soft
 * deleted and past retention when the job runs, so a restore after scheduling makes the job a
 * no-op rather than a mistake.
 */
export const purgeProcessor = async (job: Job<PurgeJobData>): Promise<PurgeResult> => {
  if (job.name === 'scan-users') {
    return { scanned: await scanUsersForPurge() };
  }

  const { userId } = job.data;
  if (!userId) {
    throw new Error(`Purge job ${job.id} has no userId`);
  }

  const retentionDate = new Date(Date.now() - config.USER_DELETION_RETENTION_MS);
  // The raw collection on purpose: the model blocks hard deletes everywhere else
  const { deletedCount } = await User.collection.deleteOne({
    _id: new Types.ObjectId(userId),
    deleted: true,
    deletedAt: { $lte: retentionDate },
  });

  const deleted = deletedCount === 1;
  logger.info(deleted ? 'User purged' : 'User purge skipped', {
    event: deleted ? 'user.purge.completed' : 'user.purge.skipped',
    userId,
  });
  return { deleted, userId };
};
