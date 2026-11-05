import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { RateLimitError } from '../errors/index.js';

export interface RateLimiterOptions {
  keyPrefix: string;
  points: number;
  durationSeconds: number;
  /** Shares the limit across instances; without it each instance counts on its own. */
  storeClient?: Redis;
}

/**
 * Fixed-window rate limit per client IP. While the Redis store is unavailable each instance falls
 * back to an in-memory limit of the same size, rather than failing requests or letting them through
 * unlimited.
 */
export const createRateLimiter = ({
  keyPrefix,
  points,
  durationSeconds,
  storeClient,
}: RateLimiterOptions): RequestHandler => {
  const memoryLimiter = new RateLimiterMemory({ keyPrefix, points, duration: durationSeconds });
  const limiter = storeClient
    ? new RateLimiterRedis({
        storeClient,
        keyPrefix,
        points,
        duration: durationSeconds,
        // Go straight to the in-memory limit instead of waiting on a Redis that is not connected
        rejectIfRedisNotReady: true,
        insuranceLimiter: memoryLimiter,
      })
    : memoryLimiter;

  const setRateLimitHeaders = (res: Response, result: RateLimiterRes): void => {
    res.setHeader('RateLimit-Limit', String(points));
    res.setHeader('RateLimit-Remaining', String(Math.max(result.remainingPoints, 0)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      setRateLimitHeaders(res, await limiter.consume(req.ip ?? 'unknown'));
      next();
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        setRateLimitHeaders(res, rejection);
        next(new RateLimitError(Math.ceil(rejection.msBeforeNext / 1000) || 1));
        return;
      }
      next(rejection);
    }
  };
};
