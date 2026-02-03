import type { NextFunction, Request, Response } from 'express';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createRedisClient } from '../../lib/redis.js';
import CustomError from '../errors/index.js';

interface RateLimiterReject {
  remainingPoints: number;
  msBeforeNext: number;
  consumedPoints: number;
  isFirstInDuration: boolean;
}

// Dedicated Redis client for Rate Limiter with offline queue disabled
// This prevents the request from hanging if Redis is down
const redisClient = createRedisClient({ enableOfflineQueue: false });

const rateLimiterMemory = new RateLimiterMemory({
  points: 100,
  duration: 60,
});

const limiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rlflx',
  points: 100,
  duration: 60,
  blockDuration: 60,
  insuranceLimiter: rateLimiterMemory,
});

export async function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.ip;
  if (!key) return next();

  try {
    const rlRes = await limiter.consume(key.toString());
    res.setHeader('RateLimit-Limit', '100');
    res.setHeader('RateLimit-Remaining', String(rlRes.remainingPoints));
    res.setHeader('RateLimit-Reset', new Date(Date.now() + rlRes.msBeforeNext).toISOString());
    next();
  } catch (rej) {
    const retrySecs = Math.ceil((rej as RateLimiterReject).msBeforeNext / 1000) || 1;
    res.setHeader('Retry-After', String(retrySecs));
    next(new CustomError(429, 'error.rate_limit_exceeded'));
  }
}
