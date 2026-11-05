import { config } from '../../config/index.js';
import { createAuthenticate, type AuthContext } from '../../core/middleware/auth/authenticate.js';
import { cache } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import User from './user.model.js';

// The version in the key retires contexts cached in an older shape the moment a deploy changes it
const cacheKey = (userId: string): string => `auth:ctx:v2:${userId}`;

/** The user's current role, activation and token version; null when the user is gone. */
export const resolveAuthContext = (userId: string): Promise<AuthContext | null> =>
  cache.wrap(cacheKey(userId), config.AUTH_CONTEXT_CACHE_TTL_SECONDS, async () => {
    const user = await User.findById(userId).select('role isActivated +tokenVersion').lean();
    if (!user) return null;

    return {
      role: user.role,
      isActivated: user.isActivated !== false,
      // Users stored before token versions existed are on the first one
      tokenVersion: user.tokenVersion ?? 0,
    };
  });

/** Call after any change to a user's role, activation, token version or existence. */
export const invalidateAuthContext = async (userId: string): Promise<void> => {
  if (!(await cache.del(cacheKey(userId)))) {
    // The stale context expires within AUTH_CONTEXT_CACHE_TTL_SECONDS, but a revocation that does not
    // apply at once is a security event someone should see
    logger.error('Auth context could not be invalidated', {
      event: 'auth.context.invalidation_failed',
      userId,
    });
  }
};

export const authenticate = createAuthenticate({
  jwtSecret: config.JWT_SECRET,
  resolveAuthContext,
});
