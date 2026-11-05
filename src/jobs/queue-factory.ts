import { type Job, type JobsOptions, type Processor, Queue, Worker } from 'bullmq';
import { getTraceId, runInContext, SYSTEM_USER_ID } from '../core/middleware/request-context.js';
import { logger } from '../lib/logger.js';
import { createRedisClient } from '../lib/redis.js';

/** Job data carries the trace id of the request that enqueued it, so its logs join that trace. */
export interface TracedJobData {
  traceId?: string;
}

const DAY_SECONDS = 24 * 60 * 60;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  // Kept long enough to inspect: completed jobs for a day, failed ones for a week
  removeOnComplete: { age: DAY_SECONDS },
  removeOnFail: { age: 7 * DAY_SECONDS },
};

const queues = new Map<string, Queue>();
const workers: Worker[] = [];

/**
 * The queue named `name`, created on first use with the default job options, on a producer
 * connection that fails fast while Redis is unreachable. Nothing connects at import time.
 */
export const getQueue = <T extends TracedJobData>(name: string): Queue<T> => {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createRedisClient(`${name}-queue`, 'bullmq-producer'),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue as Queue<T>;
};

/** Adds the current request's trace id, if any, to job data. */
export const withTraceId = <T extends object>(data: T): T & TracedJobData => {
  const traceId = getTraceId();
  return traceId ? { ...data, traceId } : { ...data };
};

/**
 * Runs a processor in a context of its own, as the system user: logs carry the trace id of the
 * request that enqueued the job, or one naming the job, and audit entries name no visitor.
 */
export const withJobContext =
  <T extends TracedJobData, R>(processor: Processor<T, R>): Processor<T, R> =>
  (job, token) =>
    runInContext(
      {
        traceId: job.data.traceId ?? `job:${job.queueName}:${job.id}`,
        ip: '',
        userId: SYSTEM_USER_ID,
      },
      () => processor(job, token),
    );

const logFailure = (queueName: string, job: Job<TracedJobData> | undefined, error: Error): void => {
  const attempts = job?.opts.attempts ?? 1;
  const fields = {
    queue: queueName,
    jobId: job?.id,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade,
    attempts,
    traceId: job?.data.traceId,
    error: error.message,
  };

  if (job && job.attemptsMade < attempts) {
    logger.warn('Job failed, retrying', { event: 'job.failed', ...fields });
  } else {
    logger.error('Job failed permanently', {
      event: 'job.failed.permanently',
      ...fields,
      stack: error.stack,
    });
  }
};

/**
 * A worker for the queue named `name`, on a connection that retries forever (BullMQ requires it
 * for blocking commands). Failures are logged as warnings while retries remain, then as an error.
 */
export const createWorker = <T extends TracedJobData, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  { concurrency = 1 }: { concurrency?: number } = {},
): Worker<T, R> => {
  const worker = new Worker<T, R>(name, withJobContext(processor), {
    connection: createRedisClient(`${name}-worker`, 'bullmq-worker'),
    concurrency,
  });

  worker.on('failed', (job, error) => {
    logFailure(name, job, error);
  });
  worker.on('error', (error) => {
    logger.error('Job worker error', {
      event: 'job.worker.error',
      queue: name,
      error: error.message,
    });
  });

  workers.push(worker);
  return worker;
};

const closeAll = async (label: string, closing: Promise<void>[]): Promise<unknown[]> => {
  const results = await Promise.allSettled(closing);
  const failures = results.flatMap((result): unknown[] =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length > 0) {
    logger.error(`Some ${label} did not close`, {
      event: 'jobs.close_failed',
      count: failures.length,
    });
  }
  return failures;
};

/**
 * Closes workers first, which lets their active jobs finish, then the queues. Throws once
 * everything has had its chance to close if anything failed to.
 */
export const closeJobQueues = async (): Promise<void> => {
  const failures = [
    ...(await closeAll(
      'workers',
      workers.splice(0).map((worker) => worker.close()),
    )),
    ...(await closeAll(
      'queues',
      [...queues.values()].map((queue) => queue.close()),
    )),
  ];
  queues.clear();

  if (failures.length > 0) throw new AggregateError(failures, 'Job queues did not close cleanly');
};
