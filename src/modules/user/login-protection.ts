import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '../../config/index.js';
import { RateLimitError } from '../../core/errors/index.js';
import { redisClient } from '../../lib/redis.js';

export interface LoginProtection {
  /** Throws RateLimitError (429, auth.too_many_attempts) while the email and IP, or the IP, is locked. */
  assertAllowed(email: string, ip: string): Promise<void>;
  recordFailure(email: string, ip: string): Promise<void>;
  recordSuccess(email: string, ip: string): Promise<void>;
}

export interface LoginProtectionOptions {
  /** Shares the counters across instances; without it each instance counts on its own. */
  storeClient?: Redis;
  maxConsecutiveFails: number;
  blockDurationSeconds: number;
  maxFailsPerIpPerDay: number;
}

type Limiter = RateLimiterMemory | RateLimiterRedis;

interface Rule {
  limiter: Limiter;
  points: number;
  blockSeconds: number;
}

const DAY_SECONDS = 24 * 60 * 60;
// Consecutive failures are forgotten on a successful login, or a day after the first one. The
// in-memory fallback expires keys with setTimeout, which cannot wait longer than about 24.8 days:
// longer windows are silently cut to 1 ms and would switch the protection off while Redis is down.
const CONSECUTIVE_WINDOW_SECONDS = DAY_SECONDS;

const createLimiter = (
  storeClient: Redis | undefined,
  keyPrefix: string,
  points: number,
  duration: number,
): Limiter => {
  const memory = new RateLimiterMemory({ keyPrefix, points, duration });
  return storeClient
    ? new RateLimiterRedis({
        storeClient,
        keyPrefix,
        points,
        duration,
        rejectIfRedisNotReady: true,
        insuranceLimiter: memory,
      })
    : memory;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Brute-force protection for login, after rate-limiter-flexible's documented pattern. Consecutive
 * failures for one email from one IP lock that pair out for a while. Failures per IP per day cap
 * credential stuffing across many accounts. There is deliberately no lock on an email alone: it would
 * let anyone lock any account out by guessing at it.
 */
export const createLoginProtection = ({
  storeClient,
  maxConsecutiveFails,
  blockDurationSeconds,
  maxFailsPerIpPerDay,
}: LoginProtectionOptions): LoginProtection => {
  const byEmailAndIp: Rule = {
    limiter: createLimiter(
      storeClient,
      'login:fail:email-ip',
      maxConsecutiveFails,
      CONSECUTIVE_WINDOW_SECONDS,
    ),
    points: maxConsecutiveFails,
    blockSeconds: blockDurationSeconds,
  };
  const byIp: Rule = {
    limiter: createLimiter(storeClient, 'login:fail:ip', maxFailsPerIpPerDay, DAY_SECONDS),
    points: maxFailsPerIpPerDay,
    blockSeconds: DAY_SECONDS,
  };

  const pairKey = (email: string, ip: string): string => `${normalizeEmail(email)}_${ip}`;

  const recordFailureFor = async ({ limiter, points, blockSeconds }: Rule, key: string) => {
    let consumed: number;
    try {
      consumed = (await limiter.consume(key)).consumedPoints;
    } catch (rejection) {
      // Rejected because the key is already over its budget: it is locked already
      if (rejection instanceof RateLimiterRes) return;
      throw rejection;
    }
    // Lock exactly when the budget is used up, for the block duration rather than the counting window
    if (consumed >= points) await limiter.block(key, blockSeconds);
  };

  const lockedForSeconds = async ({ limiter, points }: Rule, key: string): Promise<number> => {
    const state = await limiter.get(key);
    return state && state.consumedPoints > points ? Math.ceil(state.msBeforeNext / 1000) || 1 : 0;
  };

  return {
    async assertAllowed(email, ip) {
      const retryAfter = Math.max(
        await lockedForSeconds(byEmailAndIp, pairKey(email, ip)),
        await lockedForSeconds(byIp, ip),
      );
      if (retryAfter > 0) throw new RateLimitError(retryAfter, 'auth.too_many_attempts');
    },

    async recordFailure(email, ip) {
      await Promise.all([
        recordFailureFor(byEmailAndIp, pairKey(email, ip)),
        recordFailureFor(byIp, ip),
      ]);
    },

    async recordSuccess(email, ip) {
      await byEmailAndIp.limiter.delete(pairKey(email, ip));
    },
  };
};

export const loginProtection = createLoginProtection({
  storeClient: redisClient,
  maxConsecutiveFails: config.LOGIN_MAX_CONSECUTIVE_FAILS,
  blockDurationSeconds: config.LOGIN_BLOCK_DURATION_SECONDS,
  maxFailsPerIpPerDay: config.LOGIN_MAX_FAILS_PER_IP_PER_DAY,
});
