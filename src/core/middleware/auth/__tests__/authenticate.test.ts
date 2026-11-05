import express from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'winston';
import { createErrorHandler } from '../../error-handler.js';
import { contextMiddleware, getContext } from '../../request-context.js';
import { createAuthenticate, type AuthContext } from '../authenticate.js';

const SECRET = 'test-secret-that-is-long-enough-for-hs256';
const USER_ID = '64b7f0c2a1b2c3d4e5f60718';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const tokenFor = (payload: object = {}, options: SignOptions = {}) =>
  jwt.sign(payload, SECRET, { algorithm: 'HS256', subject: USER_ID, ...options });

const contextOf = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  role: 'user',
  isActivated: true,
  passwordChangedAt: null,
  ...overrides,
});

const buildApp = (
  resolveAuthContext = vi.fn(() => Promise.resolve<AuthContext | null>(contextOf())),
) => {
  const app = express();
  app.use(contextMiddleware);
  app.get('/me', createAuthenticate({ jwtSecret: SECRET, resolveAuthContext }), (req, res) => {
    res.json({ user: req.user, contextUserId: getContext()?.userId });
  });
  app.use(
    createErrorHandler({
      logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
      nodeEnv: 'test',
    }),
  );
  return app;
};

const getMe = (app: express.Express, token?: string) => {
  const req = request(app).get('/me');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('createAuthenticate', () => {
  it('rejects a request without a bearer token with auth.missing_token', async () => {
    const res = await getMe(buildApp());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.missing_token');
  });

  it('rejects an expired token with auth.token_expired', async () => {
    const res = await getMe(buildApp(), tokenFor({ exp: nowSeconds() - 10 }));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.token_expired');
  });

  it('rejects a token signed with another secret with auth.invalid_token', async () => {
    const forged = jwt.sign({}, 'another-secret-that-is-also-long-enough', {
      algorithm: 'HS256',
      subject: USER_ID,
    });

    const res = await getMe(buildApp(), forged);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
  });

  it('rejects a token signed with another algorithm', async () => {
    const res = await getMe(buildApp(), tokenFor({}, { algorithm: 'HS512' }));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
  });

  it('rejects tokens of users that no longer exist', async () => {
    const res = await getMe(buildApp(vi.fn(() => Promise.resolve(null))), tokenFor());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
  });

  it('rejects tokens issued before the last password change', async () => {
    const changedAt = new Date().toISOString();

    const res = await getMe(
      buildApp(vi.fn(() => Promise.resolve(contextOf({ passwordChangedAt: changedAt })))),
      tokenFor({ iat: nowSeconds() - 60 }),
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
  });

  it('accepts a token issued in the same second as the password change', async () => {
    const changedAt = new Date();

    const res = await getMe(
      buildApp(
        vi.fn(() => Promise.resolve(contextOf({ passwordChangedAt: changedAt.toISOString() }))),
      ),
      tokenFor({ iat: Math.floor(changedAt.getTime() / 1000) }),
    );

    expect(res.status).toBe(200);
  });

  it('rejects deactivated accounts with 403 auth.account_disabled', async () => {
    const res = await getMe(
      buildApp(vi.fn(() => Promise.resolve(contextOf({ isActivated: false })))),
      tokenFor(),
    );

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('auth.account_disabled');
  });

  it('takes the role from the auth context, not from the token', async () => {
    const res = await getMe(
      buildApp(vi.fn(() => Promise.resolve(contextOf({ role: 'admin' })))),
      tokenFor({ role: 'user' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, role: 'admin' });
  });

  it('records the user on the request context', async () => {
    const res = await getMe(buildApp(), tokenFor());

    expect(res.body.contextUserId).toBe(USER_ID);
  });
});
