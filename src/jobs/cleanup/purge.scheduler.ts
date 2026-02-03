import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import User from '../../modules/user/user.model.js';
import { purgeQueue } from '../queues.js';

const RETENTION_MS = config.USER_DELETION_RETENTION_MS;
const BATCH_SIZE = 500;

export async function scanUsersForPurge() {
  logger.info('Starting user purge scan...');
  const retentionDate = new Date(Date.now() - RETENTION_MS);

  let lastId: string | null = null;
  let processedCount = 0;

  while (true) {
    const query: Record<string, unknown> = {
      deleted: true,
      deletedAt: { $lte: retentionDate },
    };

    if (lastId) {
      query._id = { $gt: lastId };
    }

    const users = await User.find(query)
      .withDeleted()
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id')
      .lean();

    if (users.length === 0) break;

    const jobs = users.map((user) => ({
      name: 'purge-user',
      data: { userId: user._id.toString() },
      opts: {
        jobId: `purge-user-${user._id.toString()}`,
      },
    }));

    await purgeQueue.addBulk(jobs);

    processedCount += users.length;
    lastId = users[users.length - 1]._id.toString();
  }

  logger.info(`User purge scan completed. Enqueued ${processedCount} users.`);
  return processedCount;
}
