import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import CustomError from '../../core/errors/index.js';
import { purgeQueue } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import User, { type IUser } from './user.model.js';
import type { AuthResponse, UserResponse } from './user.types.js';
import type { LoginInput, RegisterInput, UserQueryInput } from './user.validators.js';

export async function registerUser(data: RegisterInput): Promise<UserResponse> {
  const existing = await User.findOne({ email: data.email }).withDeleted();
  if (existing) {
    throw new CustomError(409, 'user.email_in_use');
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);

  const user = await User.create({
    ...data,
    password: hashedPassword,
  });
  const { password: _password, ...response } = user.toObject();

  return response;
}

export async function loginUser(data: LoginInput): Promise<AuthResponse> {
  const user = await User.findOne({ email: data.email }).withDeleted().select('+password');
  if (!user) {
    throw new CustomError(401, 'auth.invalid_credentials');
  }

  const isValid = await bcrypt.compare(data.password, user.password);
  if (!isValid) {
    throw new CustomError(401, 'auth.invalid_credentials');
  }

  let wasRestored = false;
  if (user.deleted) {
    await user.restore();

    const jobId = `purge-user-${user._id.toString()}`;
    const job = await purgeQueue.getJob(jobId);
    if (job) {
      await job.remove();
      logger.info(`Account restored, purge job cancelled for: ${user.email}`);
    }

    wasRestored = true;
    logger.info(`Account restored: ${user.email}`);
  }

  const token = jwt.sign({ id: user._id.toString(), role: user.role }, config.JWT_SECRET, {
    expiresIn: '1d',
  });

  const { password: _password, ...userResponse } = user.toObject();

  return {
    user: userResponse,
    token,
    wasRestored,
  };
}

export async function deleteUser(userId: string): Promise<void> {
  const user = await User.softDeleteById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  const jobId = `purge-user-${userId}`;

  const existingJob = await purgeQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
    logger.info(`Existing purge job removed for user ${userId}`);
  }

  await purgeQueue.add(
    'purge-user',
    { userId: userId },
    {
      jobId: jobId,
      delay: config.USER_DELETION_RETENTION_MS,
    },
  );
}

export async function updateUser(userId: string, data: Partial<IUser>): Promise<UserResponse> {
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
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  if (user.photoUrl && !user.photoUrl.includes('node.js_logo')) {
    const oldFilePath = user.photoUrl.replace('/uploads/', 'uploads/');
    try {
      const fs = await import('fs/promises');
      await fs.unlink(oldFilePath);
    } catch {
      logger.warn(`Failed to delete old avatar: ${oldFilePath}`);
    }
  }

  user.photoUrl = `/uploads/${file.filename}`;
  await user.save();

  return user;
}

export async function getUser(userId: string): Promise<UserResponse> {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  return user;
}

export async function getUsers(query: UserQueryInput): Promise<UserResponse[]> {
  const q = User.find();

  if (query.includeDeleted) {
    q.withDeleted();
  }

  if (query.onlyDeleted) {
    q.onlyDeleted();
  }

  return q.exec();
}

export async function findById(userId: string): Promise<UserResponse> {
  const user = await User.findById(userId).withDeleted();
  if (!user) {
    throw new CustomError(404, 'user.not_found');
  }

  return user;
}
