import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { config } from '../../config/index.js';
import { redactAuditTrail } from '../../database/plugins/audit-log.plugin.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../lib/storage.js';
import User from '../../modules/user/user.model.js';
import type { PurgeJobData } from './purge.queue.js';
import { scanUsersForPurge } from './purge.scheduler.js';

export type PurgeResult = { scanned: number } | { deleted: boolean; userId: string };

// Only files this app stored are removed; the default avatar is an external URL
const removeUploadedAvatar = async (photoUrl: unknown, userId: string): Promise<void> => {
  if (typeof photoUrl !== 'string' || !photoUrl.startsWith('/uploads/')) return;

  await storage.remove(photoUrl).catch((error: unknown) => {
    logger.error('Avatar of a purged user could not be removed', {
      event: 'user.purge.avatar_cleanup_failed',
      userId,
      photoUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

/**
 * Processes the purge queue. A purge-user job hard deletes the user only if it is still soft
 * deleted and past retention when the job runs, so a restore after scheduling makes the job a
 * no-op rather than a mistake. "Permanently removed" covers more than the user document: the
 * uploaded avatar goes too, and the audit log keeps its entries but loses the personal data in them.
 */
export const purgeProcessor = async (job: Job<PurgeJobData>): Promise<PurgeResult> => {
  if (job.name === 'scan-users') {
    return { scanned: await scanUsersForPurge() };
  }

  const { userId } = job.data;
  if (!userId) {
    throw new Error(`Purge job ${job.id} has no userId`);
  }

  const _id = new Types.ObjectId(userId);
  const retentionDate = new Date(Date.now() - config.USER_DELETION_RETENTION_MS);
  // The raw collection on purpose: the model blocks hard deletes everywhere else
  const purged = await User.collection.findOneAndDelete({
    _id,
    deleted: true,
    deletedAt: { $lte: retentionDate },
  });

  // A run that deleted the user and then failed is retried and finds the user already gone; the
  // erasure is safe to repeat, so it runs whenever the user no longer exists
  const gone =
    purged !== null || (await User.collection.countDocuments({ _id }, { limit: 1 })) === 0;
  if (gone) {
    await redactAuditTrail({ model: User.modelName, documentId: userId, actorId: userId });
  }
  if (purged) {
    await removeUploadedAvatar(purged.photoUrl, userId);
  }

  const deleted = purged !== null;
  logger.info(deleted ? 'User purged' : 'User purge skipped', {
    event: deleted ? 'user.purge.completed' : 'user.purge.skipped',
    userId,
  });
  return { deleted, userId };
};
