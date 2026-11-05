import type { Job, Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config/index.js';
import { runInContext } from '../../../core/middleware/request-context.js';
import User from '../../../modules/user/user.model.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { getQueue } from '../../queue-factory.js';
import { cancelPurge, type PurgeJobData, schedulePurge } from '../purge.queue.js';
import { scanUsersForPurge } from '../purge.scheduler.js';
import { purgeProcessor } from '../purge.worker.js';

vi.mock('../../queue-factory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queue-factory.js')>()),
  getQueue: vi.fn(),
}));

setupTestDatabase();

const queue = { add: vi.fn(), addBulk: vi.fn(), remove: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQueue).mockReturnValue(queue as unknown as Queue);
});

const pastRetention = () => new Date(Date.now() - config.USER_DELETION_RETENTION_MS - 60_000);

// Raw inserts: the tests control the soft-delete fields exactly
const insertUser = async (email: string, state: { deleted: boolean; deletedAt: Date | null }) => {
  const { insertedId } = await User.collection.insertOne({
    email,
    name: 'Pat',
    surname: 'Purge',
    password: 'not-a-real-hash',
    role: 'user',
    isActivated: true,
    ...state,
  });
  return insertedId.toString();
};

const purgeJob = (userId?: string) =>
  ({ name: 'purge-user', data: { userId } }) as unknown as Job<PurgeJobData>;

const remainingEmails = async () =>
  (await User.collection.find().toArray()).map((user) => user.email as string).sort();

describe('purge queue', () => {
  it('schedulePurge replaces an existing job with a delayed one carrying the trace id', async () => {
    await runInContext({ traceId: 'trace-7', ip: '::1' }, () => schedulePurge('u-1'));

    expect(queue.remove).toHaveBeenCalledWith('purge-user-u-1');
    expect(queue.add).toHaveBeenCalledWith(
      'purge-user',
      { userId: 'u-1', traceId: 'trace-7' },
      { jobId: 'purge-user-u-1', delay: config.USER_DELETION_RETENTION_MS },
    );
    expect(queue.remove.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });

  it('cancelPurge removes a pending job', async () => {
    await cancelPurge('u-2');

    expect(queue.remove).toHaveBeenCalledWith('purge-user-u-2');
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('purge processor', () => {
  it('deletes only users past retention', async () => {
    const ids = await Promise.all([
      insertUser('expired@example.com', { deleted: true, deletedAt: pastRetention() }),
      insertUser('recent@example.com', { deleted: true, deletedAt: new Date() }),
      insertUser('active@example.com', { deleted: false, deletedAt: null }),
    ]);

    for (const id of ids) await purgeProcessor(purgeJob(id));

    expect(await remainingEmails()).toEqual(['active@example.com', 'recent@example.com']);
  });

  it('skips users restored since scheduling', async () => {
    const id = await insertUser('restored@example.com', { deleted: false, deletedAt: null });

    await expect(purgeProcessor(purgeJob(id))).resolves.toMatchObject({ deleted: false });
    expect(await remainingEmails()).toEqual(['restored@example.com']);
  });

  it('rejects a purge job without a user id', async () => {
    await expect(purgeProcessor(purgeJob())).rejects.toThrow('userId');
  });
});

describe('scanUsersForPurge', () => {
  it('enqueues a purge for every user past retention', async () => {
    const expired = await insertUser('expired@example.com', {
      deleted: true,
      deletedAt: pastRetention(),
    });
    await insertUser('recent@example.com', { deleted: true, deletedAt: new Date() });
    await insertUser('active@example.com', { deleted: false, deletedAt: null });

    expect(await scanUsersForPurge()).toBe(1);
    expect(queue.addBulk).toHaveBeenCalledWith([
      { name: 'purge-user', data: { userId: expired }, opts: { jobId: `purge-user-${expired}` } },
    ]);
  });
});
