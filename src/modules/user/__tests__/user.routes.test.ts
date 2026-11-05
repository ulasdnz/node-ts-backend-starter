import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initExpress } from '../../../core/loaders/express.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { createLoginProtection, type LoginProtection } from '../login-protection.js';
import User from '../user.model.js';

vi.mock('../../../jobs/queues.js', () => ({
  purgeQueue: { add: vi.fn(), getJob: vi.fn() },
}));

// The client never becomes ready: rate limits run on their in-memory fallback
vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const client = createRedisMock();
  client.status = 'end';
  return { redisClient: client, createRedisClient: () => client };
});

// Every test gets a fresh login limiter, so failed attempts in one test cannot block another
const protection = vi.hoisted(() => ({ current: undefined as LoginProtection | undefined }));
vi.mock('../login-protection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../login-protection.js')>();
  const delegate: LoginProtection = {
    assertAllowed: (email, ip) => protection.current!.assertAllowed(email, ip),
    recordFailure: (email, ip) => protection.current!.recordFailure(email, ip),
    recordSuccess: (email, ip) => protection.current!.recordSuccess(email, ip),
  };
  return { ...actual, loginProtection: delegate };
});

setupTestDatabase();

const PASSWORD = 'Password123!';
let app: Express;

const register = (email: string, password = PASSWORD) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, name: 'Test', surname: 'User' });

const login = (email: string, password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

beforeAll(async () => {
  app = await initExpress();
});

beforeEach(() => {
  vi.restoreAllMocks();
  protection.current = createLoginProtection({
    maxConsecutiveFails: 5,
    blockDurationSeconds: 900,
    maxFailsPerIpPerDay: 100,
  });
});

describe('registration', () => {
  it('creates a user', async () => {
    const res = await register('integration@example.com');

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('integration@example.com');
    expect(res.body.data.password).toBeUndefined();
    expect(await User.countDocuments({ email: 'integration@example.com' })).toBe(1);
  });

  it('maps a duplicate registration to 409 user.email_in_use without a pre-check', async () => {
    const results = await Promise.allSettled([
      register('race@example.com'),
      register('race@example.com'),
    ]);
    const responses = results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(responses.find((res) => res.status === 409)?.body.error.code).toBe('user.email_in_use');
  });
});

describe('login', () => {
  it('returns a token for valid credentials', async () => {
    await register('login@example.com');

    const res = await login('login@example.com');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
  });

  it('answers an unknown email and a wrong password identically', async () => {
    await register('same@example.com');

    const unknown = await login('nobody@example.com');
    const wrong = await login('same@example.com', 'WrongPassword1!');

    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(unknown.body.error.code).toBe('auth.invalid_credentials');
    expect(wrong.body.error.code).toBe('auth.invalid_credentials');
  });

  it('runs bcrypt for unknown emails too', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');

    await login('ghost@example.com');

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('blocks the attempt after five failures with 429 and Retry-After', async () => {
    await register('locked@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('locked@example.com', 'WrongPassword1!');
    }

    // Even the right password is refused while the lock lasts
    const res = await login('locked@example.com');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('auth.too_many_attempts');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects a deactivated account after a correct password with 403 auth.account_disabled', async () => {
    await register('disabled@example.com');
    await User.updateOne({ email: 'disabled@example.com' }, { isActivated: false });

    const res = await login('disabled@example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('auth.account_disabled');
  });

  it('normalizes the email when logging in', async () => {
    await register('casey@example.com');

    const res = await login('  CASEY@Example.COM ');

    expect(res.status).toBe(200);
  });
});
