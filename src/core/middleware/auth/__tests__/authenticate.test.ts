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

// Tokens carry the token version they were issued under; 0 unless a test says otherwise
const tokenFor = (payload: object = {}, options: SignOptions = {}) =>
  jwt.sign({ ver: 0, ...payload }, SECRET, { algorithm: 'HS256', subject: USER_ID, ...options });

const contextOf = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  role: 'user',
  isActivated: true,
  tokenVersion: 0,
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

  // A password change or an account restore moves the user to the next version. Tokens of an
  // older version are revoked however recently they were issued, the change's own second included.
  it('rejects a token of an older token version, however recent', async () => {
    const res = await getMe(
      buildApp(vi.fn(() => Promise.resolve(contextOf({ tokenVersion: 1 })))),
      tokenFor({ ver: 0, iat: nowSeconds() + 1 }),
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
  });

  it('accepts a token of the current token version', async () => {
    const res = await getMe(
      buildApp(vi.fn(() => Promise.resolve(contextOf({ tokenVersion: 3 })))),
      tokenFor({ ver: 3 }),
    );

    expect(res.status).toBe(200);
  });

  it('rejects a token without a token version', async () => {
    const unversioned = jwt.sign({}, SECRET, { algorithm: 'HS256', subject: USER_ID });

    const res = await getMe(buildApp(), unversioned);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_token');
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
