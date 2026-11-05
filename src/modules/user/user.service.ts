import CustomError from '../../core/errors/index.js';
import { setUserId } from '../../core/middleware/request-context.js';
import { detectImageExtension } from '../../core/middleware/upload.js';
import type { MongoError } from '../../core/types/mongo.types.js';
import { cancelPurge, schedulePurge } from '../../jobs/cleanup/purge.queue.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../lib/storage.js';
import { type Page, paginate } from '../../utils/pagination.js';
import { loginProtection } from './login-protection.js';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password.js';
import { invalidateAuthContext } from './user.auth-context.js';
import User from './user.model.js';
import { issueAccessToken } from './user.tokens.js';
import type { AuthResponse, UserResponse } from './user.types.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateUserInput,
  UserQueryInput,
} from './user.validators.js';

const USER_SORT_FIELDS = ['createdAt', 'email', 'name', 'surname'];

export async function registerUser(data: RegisterInput): Promise<UserResponse> {
  try {
    const user = await User.create({ ...data, password: await hashPassword(data.password) });
    const { password: _password, tokenVersion: _tokenVersion, ...response } = user.toObject();
    return response;
  } catch (error) {
    // The unique index decides, so two simultaneous sign-ups with one email cannot both succeed.
    // Soft-deleted accounts keep their email until they are purged.
    if ((error as MongoError).code === 11000) throw new CustomError(409, 'user.email_in_use');
    throw error;
  }
}

export async function loginUser(data: LoginInput, ip: string): Promise<AuthResponse> {
  await loginProtection.assertAllowed(data.email, ip);

  const user = await User.findOne({ email: data.email })
    .withDeleted()
    .select('+password +tokenVersion');
  // Unknown emails cost the same bcrypt work, so timing does not reveal which emails exist
  const isValid = user
    ? await verifyPassword(data.password, user.password)
    : await verifyAgainstDummyHash(data.password);

  if (!user || !isValid) {
    await loginProtection.recordFailure(data.email, ip);
    throw new CustomError(401, 'auth.invalid_credentials');
  }
  await loginProtection.recordSuccess(data.email, ip);
  // From here on, logs and audit entries name the user who has just proved who they are
  setUserId(user.id);

  if (!user.isActivated) {
    throw new CustomError(403, 'auth.account_disabled');
  }

  let wasRestored = false;
  if (user.deleted) {
    // A new token version: the tokens from before the deletion do not come back with the account
    user.tokenVersion += 1;
    await user.restore();
    try {
      await cancelPurge(user.id);
    } catch (error) {
      // The pending purge re-checks the user before deleting anything, so one left behind is harmless
      logger.warn('Purge of a restored account could not be cancelled', {
        event: 'user.purge.cancel_failed',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await invalidateAuthContext(user.id);

    wasRestored = true;
    logger.info('Account restored on login', { event: 'user.account.restored', userId: user.id });
  }

  const token = issueAccessToken(user.id, user.tokenVersion);

  const { password: _password, tokenVersion: _tokenVersion, ...userResponse } = user.toObject();

  return {
    user: userResponse,
    token,
    wasRestored,
  };
}

export async function changePassword(
  userId: string,
  { currentPassword, newPassword }: ChangePasswordInput,
): Promise<string> {
  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  if (!(await verifyPassword(currentPassword, user.password))) {
    throw new CustomError(400, 'user.invalid_current_password');
  }

  // One atomic update moves the user to the next token version, which revokes every token issued
  // before; two changes at once cannot both hand out tokens of the same version
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    {
      $set: { password: await hashPassword(newPassword), passwordChangedAt: new Date() },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: 'after' },
  ).select('+tokenVersion');
  if (!updated) {
    throw new CustomError(404, 'user.not_found');
  }
  await invalidateAuthContext(userId);

  // The caller's own token is one of those revoked, so it gets a new one
  return issueAccessToken(userId, updated.tokenVersion);
}

export async function deleteUser(userId: string): Promise<void> {
  const user = await User.softDeleteById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  try {
    await schedulePurge(userId);
  } catch (error) {
    // A delete the purge never follows would be a broken promise to the user: undo it, so the
    // request fails as a whole and can be retried
    await User.restoreById(userId).catch((rollbackError: unknown) => {
      logger.error('Account deletion could not be rolled back', {
        event: 'user.delete.rollback_failed',
        userId,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    });
    throw error;
  }

  await invalidateAuthContext(userId);
}

export async function updateUser(userId: string, data: UpdateUserInput): Promise<UserResponse> {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  if (data.email && data.email !== user.email) {
    const existing = await User.findOne({ email: data.email }).withDeleted();
    if (existing) {
      throw new CustomError(409, 'user.email_in_use');
    }
  }

  Object.assign(user, data);
  await user.save();

  return user;
}

export async function updateAvatar(
  userId: string,
  file: Express.Multer.File,
): Promise<UserResponse> {
  // The content decides, not the client's file name or Content-Type
  const extension = detectImageExtension(file.buffer);
  if (!extension) {
    throw new CustomError(400, 'upload.only_images');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  const previousPhotoUrl = user.photoUrl;
  user.photoUrl = await storage.save(file.buffer, extension);
  await user.save();

  // Only files this app stored are removed; the default avatar is an external URL
  if (previousPhotoUrl?.startsWith('/uploads/')) {
    await storage.remove(previousPhotoUrl).catch((error: unknown) => {
      logger.warn('Previous avatar could not be removed', {
        event: 'user.avatar.cleanup_failed',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return user;
}

export async function getUser(userId: string): Promise<UserResponse> {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  return user;
}

export async function getUsers({
  includeDeleted,
  onlyDeleted,
  ...pagination
}: UserQueryInput): Promise<Page<UserResponse>> {
  const query = User.find();
  if (onlyDeleted) query.onlyDeleted();
  else if (includeDeleted) query.withDeleted();

  return paginate(query, pagination, {
    allowedSortFields: USER_SORT_FIELDS,
    defaultSort: { createdAt: -1 },
  });
}

export async function findById(userId: string): Promise<UserResponse> {
  const user = await User.findById(userId).withDeleted();
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  return user;
}
