import type { Queue } from 'bullmq';
import type { Types } from 'mongoose';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import User from '../../modules/user/user.model.js';
import { getQueue, withTraceId } from '../queue-factory.js';
import { PURGE_QUEUE, purgeJobId, type PurgeJobData } from './purge.queue.js';

const BATCH_SIZE = 500;

/**
 * A purge job that has run keeps the user's fixed id until BullMQ trims it, and BullMQ ignores an
 * add whose id exists. The scan only reaches users who are still there, so a job of theirs that
 * failed or completed did not purge them; it is retried instead, with a fresh set of attempts.
 * retry() moves the job only if it is still in that state, so a waiting, delayed or active job is
 * never touched; if the job changed in between, retry() throws, and the scan job fails and BullMQ
 * runs it again.
 */
const retryFinishedPurge = async (queue: Queue<PurgeJobData>, userId: string): Promise<void> => {
  const job = await queue.getJob(purgeJobId(userId));
  if (!job) return;

  const state = await job.getState();
  if (state === 'failed' || state === 'completed') {
    await job.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
  }
};

/**
 * Enqueues a purge for every user past retention, in batches walked by _id. Purge jobs have fixed
 * ids, so a user whose job is still pending is not enqueued twice, and a job that already ran
 * without purging its user is retried. Returns how many it enqueued.
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

    const userIds = users.map(({ _id }) => _id.toString());
    await Promise.all(userIds.map((userId) => retryFinishedPurge(queue, userId)));
    await queue.addBulk(
      userIds.map((userId) => ({
        name: 'purge-user',
        data: withTraceId({ userId }),
        opts: { jobId: purgeJobId(userId) },
      })),
    );

    enqueued += users.length;
    lastId = users[users.length - 1]._id;
  }

  logger.info('Purge scan finished', { event: 'user.purge.scan_completed', enqueued });
  return enqueued;
};
