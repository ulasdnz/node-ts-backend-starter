import { Job } from 'bullmq';
import { Types } from 'mongoose';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import User from '../../modules/user/user.model.js';
import { scanUsersForPurge } from './purge.scheduler.js';

const RETENTION_MS = config.USER_DELETION_RETENTION_MS;

interface PurgeJobData {
  userId?: string;
}

export default async function purgeProcessor(job: Job<PurgeJobData>) {
  if (job.name === 'scan-users') {
    await scanUsersForPurge();
    return { scanned: true };
  }

  if (job.name === 'purge-user') {
    logger.info(`Purging user: ${job.data.userId}`);

    const { userId } = job.data;
    if (!userId) {
      throw new Error('UserId is required for purge-user job');
    }

    const retentionDate = new Date(Date.now() - RETENTION_MS);

    // Double check conditions before hard delete
    const result = await User.collection.deleteOne({
      _id: new Types.ObjectId(userId),
      deleted: true,
      deletedAt: { $lte: retentionDate },
    });

    if (result.deletedCount === 0) {
      logger.info(`Purge skipped for user ${userId}: Conditions not met or already deleted.`);
      return { deleted: false, reason: 'Conditions not met or already deleted' };
    }

    logger.info(`User hard deleted successfully: ${userId}`);
    return { deleted: true, userId };
  }
}
