import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../../config/index.js';

/**
 * Access tokens carry the user id (`sub`) and the user's token version (`ver`). Role and activation
 * are looked up per request through the auth context, so nothing in a token can go stale; moving
 * the user to a new version revokes every token issued before.
 */
export const issueAccessToken = (userId: string, tokenVersion: number): string =>
  jwt.sign({ ver: tokenVersion }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    // Validated as a duration by the config schema
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
