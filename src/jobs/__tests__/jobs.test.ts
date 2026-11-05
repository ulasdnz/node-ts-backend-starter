import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initJobs } from '../index.js';
import { createWorker, getQueue } from '../queue-factory.js';

vi.mock('../queue-factory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queue-factory.js')>()),
  createWorker: vi.fn(),
  getQueue: vi.fn(),
}));

const queue = { upsertJobScheduler: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQueue).mockReturnValue(queue as unknown as Queue);
});

describe('initJobs', () => {
  it('starts no worker when workers are disabled', async () => {
    await initJobs({ workersEnabled: false });

    expect(createWorker).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('starts the purge worker and schedules the daily scan', async () => {
    await initJobs({ workersEnabled: true });

    expect(createWorker).toHaveBeenCalledWith('user-purge', expect.any(Function), {
      concurrency: 5,
    });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'scan-users-daily',
      { pattern: '0 0 * * *', utc: true },
      { name: 'scan-users', data: {} },
    );
  });
});
