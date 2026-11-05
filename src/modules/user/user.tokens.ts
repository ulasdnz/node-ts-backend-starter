import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../../config/index.js';

/**
 * Access tokens carry only the user id (`sub`). Role, activation and revocation are looked up per
 * request through the auth context, so nothing in a token can go stale.
 */
export const issueAccessToken = (userId: string): string =>
  jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    // Validated as a duration by the config schema
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
