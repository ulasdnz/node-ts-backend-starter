import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../lib/logger.js';
import { redisClient } from '../../../lib/redis.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import type { RedisMock } from '../../../test/helpers/redis-mock.js';
import { invalidateAuthContext, resolveAuthContext } from '../user.auth-context.js';
import User from '../user.model.js';

vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const client = createRedisMock();
  return { redisClient: client, createRedisClient: () => client };
});

setupTestDatabase();

const redis = redisClient as unknown as RedisMock;

const createUser = (overrides: Record<string, unknown> = {}) =>
  User.create({
    email: 'context@example.com',
    password: 'not-a-real-hash',
    name: 'Context',
    surname: 'User',
    ...overrides,
  });

beforeEach(() => {
  redis._clear();
  vi.restoreAllMocks();
});

describe('resolveAuthContext', () => {
  it('loads the auth context of an active user', async () => {
    const user = await createUser({ role: 'admin', tokenVersion: 2 });

    await expect(resolveAuthContext(user.id)).resolves.toEqual({
      role: 'admin',
      isActivated: true,
      tokenVersion: 2,
    });
  });

  it('treats a user stored before token versions existed as version 0', async () => {
    const user = await createUser();
    await User.collection.updateOne({ _id: user._id }, { $unset: { tokenVersion: '' } });

    await expect(resolveAuthContext(user.id)).resolves.toMatchObject({ tokenVersion: 0 });
  });

  it('returns null for a soft-deleted user', async () => {
    const user = await createUser();
    await User.softDeleteById(user.id);

    await expect(resolveAuthContext(user.id)).resolves.toBeNull();
  });

  it('serves repeated lookups from the cache', async () => {
    const user = await createUser();
    const findById = vi.spyOn(User, 'findById');

    await resolveAuthContext(user.id);
    await resolveAuthContext(user.id);

    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('invalidation forces a fresh read', async () => {
    const user = await createUser();
    await resolveAuthContext(user.id);
    await User.updateOne({ _id: user._id }, { role: 'admin' });

    await invalidateAuthContext(user.id);

    await expect(resolveAuthContext(user.id)).resolves.toMatchObject({ role: 'admin' });
  });

  it('logs an error when invalidation fails', async () => {
    const user = await createUser();
    redis.del.mockRejectedValueOnce(new Error('connection lost'));
    const error = vi.spyOn(logger, 'error');

    await invalidateAuthContext(user.id);

    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'auth.context.invalidation_failed', userId: user.id }),
    );
  });
});
