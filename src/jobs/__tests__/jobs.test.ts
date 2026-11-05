import type { Queue, Worker } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initJobs } from '../index.js';
import { createWorker, getQueue } from '../queue-factory.js';

vi.mock('../queue-factory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queue-factory.js')>()),
  createWorker: vi.fn(),
  getQueue: vi.fn(),
}));

const queue = { upsertJobScheduler: vi.fn(), waitUntilReady: vi.fn() };
const worker = { waitUntilReady: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQueue).mockReturnValue(queue as unknown as Queue);
  vi.mocked(createWorker).mockReturnValue(worker as unknown as Worker);
});

describe('initJobs', () => {
  it('starts no worker when workers are disabled', async () => {
    await initJobs({ workersEnabled: false });

    expect(createWorker).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  // A queue first used while Redis is down stays broken, so every instance connects it at startup,
  // when Redis has just been reached
  it('connects the purge queue on every instance, workers or not', async () => {
    await initJobs({ workersEnabled: false });

    expect(getQueue).toHaveBeenCalledWith('user-purge');
    expect(queue.waitUntilReady).toHaveBeenCalled();
  });

  it('fails startup when the purge queue cannot connect', async () => {
    queue.waitUntilReady.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(initJobs({ workersEnabled: false })).rejects.toThrow('Connection is closed.');
  });

  it('starts the purge worker, waits until it is connected and schedules the daily scan', async () => {
    await initJobs({ workersEnabled: true });

    expect(createWorker).toHaveBeenCalledWith('user-purge', expect.any(Function), {
      concurrency: 5,
    });
    expect(worker.waitUntilReady).toHaveBeenCalled();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'scan-users-daily',
      { pattern: '0 0 * * *', utc: true },
      { name: 'scan-users', data: {} },
    );
  });
});
