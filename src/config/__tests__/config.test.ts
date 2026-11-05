import { describe, expect, it } from 'vitest';
import { envSchema } from '../env.schema.js';

const base = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'development',
  MONGO_URI: 'mongodb://localhost:27017/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  ...overrides,
});

describe('envSchema', () => {
  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    const result = envSchema.safeParse(base({ JWT_SECRET: 'x'.repeat(31) }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['JWT_SECRET']);
  });

  it('requires TRUST_PROXY in production', () => {
    const result = envSchema.safeParse(base({ NODE_ENV: 'production' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['TRUST_PROXY']);
  });

  it('parses TRUST_PROXY hop counts and rejects anything else', () => {
    const parse = (value: string) => envSchema.safeParse(base({ TRUST_PROXY: value }));

    expect(parse('2').data?.TRUST_PROXY).toBe(2);
    expect(parse('0').data?.TRUST_PROXY).toBe(false);
    expect(parse('false').data?.TRUST_PROXY).toBe(false);
    for (const invalid of ['true', 'abc', '-1', '11', '1.5']) {
      expect(parse(invalid).success, invalid).toBe(false);
    }
  });

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const result = envSchema.safeParse(base({ CORS_ORIGINS: ' https://a.com, https://b.com ,' }));

    expect(result.data?.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('rejects CORS origins that are not bare origins', () => {
    for (const invalid of ['https://a.com/', 'a.com', 'https://a.com/path']) {
      expect(envSchema.safeParse(base({ CORS_ORIGINS: invalid })).success, invalid).toBe(false);
    }
  });

  it('applies defaults', () => {
    const result = envSchema.parse(base());

    expect(result).toMatchObject({
      PORT: 3000,
      LOG_LEVEL: 'info',
      SHUTDOWN_TIMEOUT_MS: 8000,
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
      RATE_LIMIT_POINTS: 100,
      RATE_LIMIT_DURATION_SECONDS: 60,
      JWT_EXPIRES_IN: '1d',
      BCRYPT_SALT_ROUNDS: 10,
      AUTH_CONTEXT_CACHE_TTL_SECONDS: 60,
      LOGIN_MAX_CONSECUTIVE_FAILS: 5,
      LOGIN_BLOCK_DURATION_SECONDS: 900,
      LOGIN_MAX_FAILS_PER_IP_PER_DAY: 100,
      WORKERS_ENABLED: true,
    });
  });

  it('parses WORKERS_ENABLED as a boolean', () => {
    expect(envSchema.parse(base({ WORKERS_ENABLED: 'false' })).WORKERS_ENABLED).toBe(false);
    expect(envSchema.safeParse(base({ WORKERS_ENABLED: 'no' })).success).toBe(false);
  });

  it('rejects a JWT_EXPIRES_IN that is not a duration', () => {
    expect(envSchema.parse(base({ JWT_EXPIRES_IN: '15m' })).JWT_EXPIRES_IN).toBe('15m');
    expect(envSchema.safeParse(base({ JWT_EXPIRES_IN: 'one day' })).success).toBe(false);
  });

  it('rejects a JWT_EXPIRES_IN without a unit, which jsonwebtoken reads as milliseconds', () => {
    // "3600" would make every token expire after 3.6 seconds
    expect(envSchema.safeParse(base({ JWT_EXPIRES_IN: '3600' })).success).toBe(false);
    expect(envSchema.parse(base({ JWT_EXPIRES_IN: '3600s' })).JWT_EXPIRES_IN).toBe('3600s');
  });
});
