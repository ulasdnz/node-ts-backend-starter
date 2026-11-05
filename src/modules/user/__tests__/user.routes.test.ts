import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config/index.js';
import { initExpress } from '../../../core/loaders/express.js';
import { AuditLog } from '../../../database/plugins/audit-log.model.js';
import { flushAuditLogs } from '../../../database/plugins/audit-log.plugin.js';
import { cancelPurge, schedulePurge } from '../../../jobs/cleanup/purge.queue.js';
import { logger } from '../../../lib/logger.js';
import { storage } from '../../../lib/storage.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { expectDocumentedResponse } from '../../../test/helpers/openapi.js';
import { createLoginProtection, type LoginProtection } from '../login-protection.js';
import User from '../user.model.js';

vi.mock('../../../jobs/cleanup/purge.queue.js', () => ({
  schedulePurge: vi.fn(),
  cancelPurge: vi.fn(),
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

// Every response a test gets through these helpers is also checked against the OpenAPI document
const documented = async <T extends { status: number; body: unknown }>(
  pending: PromiseLike<T>,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
): Promise<T> => {
  const res = await pending;
  expectDocumentedResponse(res, method, path);
  return res;
};

const register = (email: string, password = PASSWORD, headers: Record<string, string> = {}) =>
  documented(
    request(app)
      .post('/api/v1/auth/register')
      .set(headers)
      .send({ email, password, name: 'Test', surname: 'User' }),
    'post',
    '/api/v1/auth/register',
  );

const login = (email: string, password = PASSWORD) =>
  documented(
    request(app).post('/api/v1/auth/login').send({ email, password }),
    'post',
    '/api/v1/auth/login',
  );

const signIn = async (email: string, password = PASSWORD): Promise<string> => {
  const res = await login(email, password);
  return res.body.data.token as string;
};

const registerAdmin = async (email: string): Promise<string> => {
  await register(email);
  await User.updateOne({ email }, { role: 'admin' });
  return signIn(email);
};

// A token of the given version, stamped one second ahead: a comparison of issue times against the
// change time could never reject it, so only the version can
const tokenOfVersion = (userId: string, version: number): string =>
  jwt.sign({ ver: version, iat: Math.floor(Date.now() / 1000) + 1 }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: '1h',
  });

const getMe = (token: string) =>
  documented(
    request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`),
    'get',
    '/api/v1/users/me',
  );

const changePassword = (token: string, body: { currentPassword: string; newPassword: string }) =>
  documented(
    request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send(body),
    'patch',
    '/api/v1/users/me/password',
  );

const deleteMe = (token: string) =>
  documented(
    request(app).delete('/api/v1/users/me').set('Authorization', `Bearer ${token}`),
    'delete',
    '/api/v1/users/me',
  );

const listUsers = (token: string, query = '') =>
  documented(
    request(app).get(`/api/v1/users${query}`).set('Authorization', `Bearer ${token}`),
    'get',
    '/api/v1/users',
  );

beforeAll(async () => {
  app = await initExpress();
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(schedulePurge).mockReset().mockResolvedValue(undefined);
  vi.mocked(cancelPurge).mockReset().mockResolvedValue(undefined);
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

  it('records the registration in the audit log with the request as the actor', async () => {
    const res = await register('audited@example.com', PASSWORD, {
      'X-Trace-Id': 'trace-register-1',
    });
    await flushAuditLogs();

    const entry = await AuditLog.findOne({ model: 'User', documentId: res.body.data._id }).lean();

    expect(entry).toMatchObject({
      operation: 'create',
      actor: { userId: 'anonymous', traceId: 'trace-register-1' },
      changes: { email: 'audited@example.com', password: '[REDACTED]' },
    });
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
    // A plain sign-in has nothing to tell the user; only a restored account gets a message
    expect(res.body).not.toHaveProperty('message');
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

  it('restores a soft-deleted account on login and cancels its purge', async () => {
    const { body } = await register('back@example.com');
    const userId = body.data._id as string;
    await User.softDeleteById(userId);

    const res = await login('back@example.com');

    expect(res.status).toBe(200);
    expect(res.body.message).toEqual(expect.any(String));
    expect(cancelPurge).toHaveBeenCalledWith(userId);
    expect((await User.findById(userId))?.deleted).toBe(false);
  });

  it('still signs a restored account in when its purge cannot be cancelled', async () => {
    const { body } = await register('stale-job@example.com');
    await User.softDeleteById(body.data._id as string);
    vi.mocked(cancelPurge).mockRejectedValueOnce(new Error('redis unreachable'));
    const warn = vi.spyOn(logger, 'warn');

    const res = await login('stale-job@example.com');

    // The purge job checks the user again before deleting anything, so a stale one is harmless
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'user.purge.cancel_failed' }),
    );
  });

  it('does not bring back the tokens of an account deleted and then restored', async () => {
    await register('returning@example.com');
    const beforeDeletion = await signIn('returning@example.com');
    await deleteMe(beforeDeletion);

    const restored = await login('returning@example.com');

    expect(restored.status).toBe(200);
    expect((await getMe(restored.body.data.token as string)).status).toBe(200);
    expect((await getMe(beforeDeletion)).status).toBe(401);
  });

  it('records the restore in the audit log as done by the user', async () => {
    const { body } = await register('owner@example.com');
    const userId = body.data._id as string;
    await User.softDeleteById(userId);

    await login('owner@example.com');
    await flushAuditLogs();

    const restore = await AuditLog.findOne({
      model: 'User',
      documentId: userId,
      operation: 'update',
      'changes.deleted': false,
    }).lean();
    expect(restore?.actor?.userId).toBe(userId);
  });
});

describe('password change', () => {
  const NEW_PASSWORD = 'NewPassword456!';

  it('changes the password, returns a working token and revokes every older one', async () => {
    const { body } = await register('rotate@example.com');
    const oldToken = await signIn('rotate@example.com');
    const sameSecondToken = tokenOfVersion(body.data._id as string, 0);
    // Caches the auth context, which the change has to invalidate
    expect((await getMe(oldToken)).status).toBe(200);

    const res = await changePassword(oldToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toEqual(expect.any(String));
    expect((await getMe(res.body.data.token as string)).status).toBe(200);
    expect((await getMe(oldToken)).status).toBe(401);
    expect((await getMe(sameSecondToken)).status).toBe(401);
    expect((await login('rotate@example.com', PASSWORD)).status).toBe(401);
    expect((await login('rotate@example.com', NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects a wrong current password with 400 user.invalid_current_password', async () => {
    await register('keeper@example.com');
    const token = await signIn('keeper@example.com');

    const res = await changePassword(token, {
      currentPassword: 'WrongPassword1!',
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('user.invalid_current_password');
    expect((await login('keeper@example.com', PASSWORD)).status).toBe(200);
  });

  // Otherwise a stolen token could guess the current password at the general rate limit, and one
  // right guess would turn a day-long token into the account for good
  it('locks guessing at the current password like failed sign-ins', async () => {
    await register('guarded@example.com');
    const token = await signIn('guarded@example.com');
    const warn = vi.spyOn(logger, 'warn');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await changePassword(token, {
        currentPassword: `Guess${attempt}Password!`,
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(400);
    }

    // Even the right password is refused while the lock lasts
    const locked = await changePassword(token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('auth.too_many_attempts');
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'user.password_change.rejected' }),
    );
  });

  it('applies the password policy to the new password', async () => {
    await register('policy@example.com');
    const token = await signIn('policy@example.com');

    const res = await changePassword(token, { currentPassword: PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('error.validation_failed');
  });
});

describe('profile and user list', () => {
  it('reads do not carry a message', async () => {
    const adminToken = await registerAdmin('reader@example.com');

    const profile = await getMe(adminToken);
    const list = await listUsers(adminToken);

    expect([profile.status, list.status]).toEqual([200, 200]);
    expect(profile.body).not.toHaveProperty('message');
    expect(list.body).not.toHaveProperty('message');
  });

  it('lists users page by page for admins', async () => {
    const adminToken = await registerAdmin('admin@example.com');
    for (const name of ['a', 'b', 'c']) await register(`${name}@list.example.com`);

    const res = await listUsers(adminToken, '?limit=2&page=2&sort=email');

    expect(res.status).toBe(200);
    expect(res.body.meta.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });
    expect(res.body.data.map((user: { email: string }) => user.email)).toEqual([
      'b@list.example.com',
      'c@list.example.com',
    ]);
  });

  it('rejects a page size above 100', async () => {
    const adminToken = await registerAdmin('limits@example.com');

    const res = await listUsers(adminToken, '?limit=101');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: 'limit', message: expect.any(String) as string },
    ]);
  });

  it("a deleted account's token stops working at once", async () => {
    await register('leaving@example.com');
    const token = await signIn('leaving@example.com');
    // Caches the auth context, which the deletion has to invalidate
    expect((await getMe(token)).status).toBe(200);

    const deletion = await deleteMe(token);

    expect(deletion.status).toBe(200);
    expect((await getMe(token)).status).toBe(401);
  });
});

describe('profile updates and admin reads', () => {
  it('updates the signed-in user', async () => {
    await register('renamed@example.com');
    const token = await signIn('renamed@example.com');

    const res = await documented(
      request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed' }),
      'patch',
      '/api/v1/users/me',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });

  it('replaces the avatar with an uploaded image', async () => {
    const save = vi.spyOn(storage, 'save').mockResolvedValue('/uploads/portrait.png');
    await register('portrait@example.com');
    const token = await signIn('portrait@example.com');

    const res = await documented(
      request(app)
        .patch('/api/v1/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('photo', PNG, { filename: 'portrait.png', contentType: 'image/png' }),
      'patch',
      '/api/v1/users/me/avatar',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.photoUrl).toBe('/uploads/portrait.png');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets an admin read any user by id', async () => {
    const adminToken = await registerAdmin('reader-admin@example.com');
    const { body } = await register('subject@example.com');

    const res = await documented(
      request(app)
        .get(`/api/v1/users/${body.data._id as string}`)
        .set('Authorization', `Bearer ${adminToken}`),
      'get',
      '/api/v1/users/{id}',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('subject@example.com');
  });
});

describe('account deletion', () => {
  it('soft deletes the account and schedules its purge', async () => {
    const { body } = await register('purged@example.com');
    const token = await signIn('purged@example.com');

    const res = await deleteMe(token);

    expect(res.status).toBe(200);
    expect(schedulePurge).toHaveBeenCalledWith(body.data._id);
    expect((await User.findById(body.data._id as string).withDeleted())?.deleted).toBe(true);
  });

  it('rolls the soft delete back when scheduling the purge fails', async () => {
    const { body } = await register('kept@example.com');
    const token = await signIn('kept@example.com');
    vi.mocked(schedulePurge).mockRejectedValueOnce(new Error('redis unreachable'));
    const error = vi.spyOn(logger, 'error');

    const res = await deleteMe(token);

    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalled();
    // Not left half-deleted: the account is active, and its token still works
    expect((await User.findById(body.data._id as string))?.deleted).toBe(false);
    expect((await getMe(token)).status).toBe(200);
  });
});
