import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { CustomError } from '../../errors/index.js';
import { setUserId } from '../request-context.js';

/** What a request needs to know about its user, kept fresh independently of the token. */
export interface AuthContext {
  role: string;
  isActivated: boolean;
  /** Tokens carry the version they were issued under; a token of any other version is revoked. */
  tokenVersion: number;
}

export interface AuthenticateOptions {
  jwtSecret: string;
  /** Resolves null when the user no longer exists (including soft-deleted users). */
  resolveAuthContext: (userId: string) => Promise<AuthContext | null>;
}

const BEARER_PREFIX = 'Bearer ';

const verifyToken = (token: string, secret: string): { userId: string; tokenVersion: number } => {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (error) {
    // TokenExpiredError extends JsonWebTokenError, so it has to be told apart first
    if (error instanceof jwt.TokenExpiredError) throw new CustomError(401, 'auth.token_expired');
    throw new CustomError(401, 'auth.invalid_token');
  }

  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new CustomError(401, 'auth.invalid_token');
  }
  const version: unknown = payload.ver;
  if (typeof version !== 'number') throw new CustomError(401, 'auth.invalid_token');

  return { userId: payload.sub, tokenVersion: version };
};

/**
 * Authenticates the bearer token, then loads the user's current auth context. The token only proves
 * identity: role, activation and revocation come from the context, so a change applies to the next
 * request instead of when the token expires.
 */
export const createAuthenticate =
  ({ jwtSecret, resolveAuthContext }: AuthenticateOptions): RequestHandler =>
  async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith(BEARER_PREFIX)) throw new CustomError(401, 'auth.missing_token');

      const { userId, tokenVersion } = verifyToken(header.slice(BEARER_PREFIX.length), jwtSecret);
      const context = await resolveAuthContext(userId);
      if (!context) throw new CustomError(401, 'auth.invalid_token');

      // Revocation moves the user to a new version instead of comparing times, which have
      // one-second precision in a JWT: every token issued before it stops working, even one issued
      // within the same second
      if (tokenVersion !== context.tokenVersion) throw new CustomError(401, 'auth.invalid_token');

      if (!context.isActivated) throw new CustomError(403, 'auth.account_disabled');

      req.user = { id: userId, role: context.role };
      setUserId(userId);
      next();
    } catch (error) {
      next(error);
    }
  };
