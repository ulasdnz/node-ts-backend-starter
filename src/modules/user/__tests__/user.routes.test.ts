import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initExpress } from '../../../core/loaders/express.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import User from '../user.model.js';

setupTestDatabase();

vi.mock('../../../jobs/queues', () => ({
  purgeQueue: {
    add: vi.fn(),
  },
}));

// The client never becomes ready, so the rate limiter uses its in-memory limit
vi.mock('../../../lib/redis', () => ({
  redisClient: {
    status: 'end',
    ping: vi.fn().mockResolvedValue('PONG'),
  },
}));

let app: Express;

describe('User Routes Integration', () => {
  beforeAll(async () => {
    app = await initExpress();
  });

  it('POST /api/v1/auth/register should create a new user', async () => {
    const userData = {
      email: 'integration@example.com',
      password: 'Password123!',
      name: 'Integration',
      surname: 'Test',
    };

    const res = await request(app).post('/api/v1/auth/register').send(userData);

    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
    expect(res.body.data.email).toBe(userData.email);

    const user = await User.findOne({ email: userData.email });
    expect(user).toBeDefined();
    expect(user?.name).toBe(userData.name);
  });

  it('POST /api/v1/auth/register should fail with duplicate email', async () => {
    const userData = {
      email: 'duplicate@example.com',
      password: 'Password123!',
      name: 'Duplicate',
      surname: 'User',
    };

    await request(app).post('/api/v1/auth/register').send(userData);

    const res = await request(app).post('/api/v1/auth/register').send(userData);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('user.email_in_use');
  });

  it('POST /api/v1/auth/login should return token for valid credentials', async () => {
    const userData = {
      email: 'login@example.com',
      password: 'Password123!',
      name: 'Login',
      surname: 'User',
    };

    await request(app).post('/api/v1/auth/register').send(userData);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: userData.email,
      password: userData.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.data.token).toBeDefined();
  });

  it('POST /api/v1/auth/login should fail for invalid credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'nonexistent@example.com',
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
  });
});
