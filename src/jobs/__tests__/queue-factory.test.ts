import type { Job } from 'bullmq';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTraceId, runInContext } from '../../core/middleware/request-context.js';
import { logger } from '../../lib/logger.js';
import {
  closeJobQueues,
  createWorker,
  DEFAULT_JOB_OPTIONS,
  getQueue,
  withJobContext,
  withTraceId,
} from '../queue-factory.js';

const bullmq = vi.hoisted(() => ({
  closed: [] as string[],
  // The next queue's first connection attempt fails
  failNextQueueStart: false,
  // A worker's graceful close never finishes, as with jobs stuck while Redis is down
  hangGracefulClose: false,
}));

// Stand-ins that record what the factory does, without Redis
vi.mock('bullmq', async () => {
  const { EventEmitter: Emitter } = await import('node:events');

  class Queue extends Emitter {
    private readonly ready: Promise<void>;

    constructor(
      readonly name: string,
      readonly opts: Record<string, unknown>,
    ) {
      super();
      this.ready = bullmq.failNextQueueStart
        ? Promise.reject(new Error('Connection is closed.'))
        : Promise.resolve();
      bullmq.failNextQueueStart = false;
    }
    waitUntilReady = () => this.ready;
    close = vi.fn(async () => {
      bullmq.closed.push(`queue:${this.name}`);
    });
  }

  class Worker extends Emitter {
    constructor(
      readonly name: string,
      readonly processor: unknown,
      readonly opts: Record<string, unknown>,
    ) {
      super();
    }
    close = vi.fn(async (force = false) => {
      if (bullmq.hangGracefulClose && !force) return new Promise<void>(() => {});
      bullmq.closed.push(force ? `worker:${this.name}:forced` : `worker:${this.name}`);
    });
  }

  return { Queue, Worker };
});

vi.mock('../../lib/redis.js', () => ({
  createRedisClient: vi.fn(() => ({ disconnect: vi.fn() })),
}));

const jobOf = (data: Record<string, unknown>, overrides: Partial<Job> = {}) =>
  ({
    id: '42',
    name: 'work',
    queueName: 'reports',
    data,
    opts: { attempts: 3 },
    ...overrides,
  }) as unknown as Job<{ traceId?: string }>;

afterEach(async () => {
  bullmq.hangGracefulClose = false;
  await closeJobQueues();
  bullmq.closed.length = 0;
  vi.restoreAllMocks();
});

describe('withJobContext', () => {
  it("exposes the job's trace id to the processor", async () => {
    const processor = withJobContext(async () => getTraceId());

    expect(await processor(jobOf({ traceId: 'trace-1' }), 'token')).toBe('trace-1');
  });

  it('falls back to a job-scoped trace id', async () => {
    const processor = withJobContext(async () => getTraceId());

    expect(await processor(jobOf({}), 'token')).toBe('job:reports:42');
  });
});

describe('withTraceId', () => {
  it("stamps the current request's trace id", () => {
    const data = runInContext({ traceId: 'trace-2', ip: '::1' }, () =>
      withTraceId({ userId: 'u-1' }),
    );

    expect(data).toEqual({ userId: 'u-1', traceId: 'trace-2' });
  });

  it('adds nothing outside a request', () => {
    expect(withTraceId({ userId: 'u-1' })).toEqual({ userId: 'u-1' });
  });
});

describe('DEFAULT_JOB_OPTIONS', () => {
  it('retries with exponential backoff', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('keeps failed jobs for seven days', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60 });
  });
});

describe('getQueue', () => {
  it('creates one queue per name, with the default job options', () => {
    const queue = getQueue('reports');

    expect(getQueue('reports')).toBe(queue);
    expect(
      (queue as unknown as { opts: { defaultJobOptions: unknown } }).opts.defaultJobOptions,
    ).toBe(DEFAULT_JOB_OPTIONS);
  });

  // BullMQ keeps the outcome of a queue's first connection attempt for good
  it('replaces a queue whose first connection failed, so later calls can work again', async () => {
    bullmq.failNextQueueStart = true;
    const broken = getQueue('reports');
    const client = (broken as unknown as { opts: { connection: { disconnect: () => void } } }).opts
      .connection;

    await expect(broken.waitUntilReady()).rejects.toThrow('Connection is closed.');
    await new Promise((resolve) => setImmediate(resolve));

    expect(getQueue('reports')).not.toBe(broken);
    expect(broken.close).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('logs queue errors', () => {
    const error = vi.spyOn(logger, 'error');

    getQueue('reports').emit('error', new Error('READONLY'));

    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'job.queue.error', queue: 'reports', error: 'READONLY' }),
    );
  });
});

describe('createWorker', () => {
  const failWith = (job: Job | undefined) => {
    const worker = createWorker('reports', async () => undefined) as unknown as EventEmitter;
    worker.emit('failed', job, new Error('upstream timeout'));
  };

  it('logs a failure as a warning while retries remain', () => {
    const warn = vi.spyOn(logger, 'warn');

    failWith(jobOf({ traceId: 'trace-3' }, { attemptsMade: 1 } as Partial<Job>));

    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'job.failed', jobId: '42', traceId: 'trace-3' }),
    );
  });

  it('logs the last failure as an error', () => {
    const error = vi.spyOn(logger, 'error');

    failWith(jobOf({ traceId: 'trace-4' }, { attemptsMade: 3 } as Partial<Job>));

    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'job.failed.permanently', jobId: '42', traceId: 'trace-4' }),
    );
  });
});

describe('closeJobQueues', () => {
  it('closes workers before queues', async () => {
    getQueue('reports');
    createWorker('reports', async () => undefined);

    await closeJobQueues();

    expect(bullmq.closed).toEqual(['worker:reports', 'queue:reports']);
  });

  it('closes a worker by force when its jobs do not finish in time', async () => {
    bullmq.hangGracefulClose = true;
    createWorker('reports', async () => undefined);

    await closeJobQueues({ workerCloseTimeoutMs: 20 });

    expect(bullmq.closed).toEqual(['worker:reports:forced']);
  });
});
