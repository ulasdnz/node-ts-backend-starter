import type { Types } from 'mongoose';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import User from '../../modules/user/user.model.js';
import { getQueue, withTraceId } from '../queue-factory.js';
import { PURGE_QUEUE, purgeJobId, type PurgeJobData } from './purge.queue.js';

const BATCH_SIZE = 500;

/**
 * Enqueues a purge for every user past retention, in batches walked by _id. Purge jobs have fixed
 * ids, so a user whose job is still pending is not enqueued twice. Returns how many it enqueued.
 */
export const scanUsersForPurge = async (): Promise<number> => {
  const retentionDate = new Date(Date.now() - config.USER_DELETION_RETENTION_MS);
  const queue = getQueue<PurgeJobData>(PURGE_QUEUE);

  let lastId: Types.ObjectId | undefined;
  let enqueued = 0;

  for (;;) {
    const users = await User.find({
      deleted: true,
      deletedAt: { $lte: retentionDate },
      ...(lastId && { _id: { $gt: lastId } }),
    })
      .withDeleted()
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id')
      .lean();

    if (users.length === 0) break;

    await queue.addBulk(
      users.map(({ _id }) => ({
        name: 'purge-user',
        data: withTraceId({ userId: _id.toString() }),
        opts: { jobId: purgeJobId(_id.toString()) },
      })),
    );

    enqueued += users.length;
    lastId = users[users.length - 1]._id;
  }

  logger.info('Purge scan finished', { event: 'user.purge.scan_completed', enqueued });
  return enqueued;
};
