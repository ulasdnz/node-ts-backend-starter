import type { Request, Response } from 'express';
import { config } from '../../config/index.js';
import CustomError from '../../core/errors/index.js';
import type { SuccessResponse } from '../../core/types/api.types.js';
import * as userService from './user.service.js';
import type { AuthResponse, UserResponse } from './user.types.js';
import type { UserQueryInput } from './user.validators.js';

export async function register(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const user = await userService.registerUser(req.body);

  res.status(201).json({
    success: true,
    message: req.t('success.register'),
    data: user,
  });
}

export async function login(
  req: Request,
  res: Response<SuccessResponse<Omit<AuthResponse, 'wasRestored'>>>,
) {
  const { wasRestored, ...result } = await userService.loginUser(req.body);

  const messageKey = wasRestored ? 'success.login_restored' : 'success.login';

  res.json({
    success: true,
    message: req.t(messageKey),
    data: result,
  });
}

export async function deleteUser(req: Request, res: Response<SuccessResponse<void>>) {
  const userId = req.user!.id;
  await userService.deleteUser(userId);

  const message = req.t('success.delete', { days: config.USER_DELETION_RETENTION_DAYS });

  res.json({
    success: true,
    message: message,
    data: undefined,
  });
}

export async function updateUser(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id;
  const result = await userService.updateUser(userId, req.body);

  res.json({
    success: true,
    message: req.t('success.update'),
    data: result,
  });
}

export async function updateAvatar(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id;

  if (!req.file) {
    throw new CustomError(400, 'user.avatar_required');
  }

  const result = await userService.updateAvatar(userId, req.file);
  res.json({
    success: true,
    message: req.t('success.avatar_update'),
    data: result,
  });
}

export async function getUser(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id;
  const user = await userService.getUser(userId);

  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  });
}

export async function getUsers(
  req: Request<unknown, unknown, unknown, UserQueryInput>,
  res: Response<SuccessResponse<UserResponse[]>>,
) {
  const users = await userService.getUsers(req.query);

  res.json({
    success: true,
    message: req.t('success.get_all'),
    data: users,
  });
}

export async function getUserById(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findById(req.params.id);

  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  });
}
