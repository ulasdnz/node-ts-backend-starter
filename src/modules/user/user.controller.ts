import type { Request, Response } from 'express';
import { config } from '../../config/index.js';
import CustomError from '../../core/errors/index.js';
import type { SuccessResponse } from '../../core/types/api.types.js';
import type { PaginationMeta } from '../../utils/pagination.js';
import * as userService from './user.service.js';
import type { AuthResponse, UserResponse } from './user.types.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateUserInput,
  UserQueryInput,
} from './user.validators.js';

// Response policy: changes answer with a localized message, reads with data alone

export async function register(
  req: Request<unknown, unknown, RegisterInput>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.registerUser(req.body);

  res.status(201).json({
    message: req.t('success.register'),
    data: user,
  });
}

export async function login(
  req: Request<unknown, unknown, LoginInput>,
  res: Response<SuccessResponse<Omit<AuthResponse, 'wasRestored'>>>,
) {
  const { wasRestored, ...result } = await userService.loginUser(req.body, req.ip ?? 'unknown');

  // A plain sign-in has nothing to tell the user; a restored account does
  res.json({
    ...(wasRestored && { message: req.t('success.login_restored') }),
    data: result,
  });
}

export async function changePassword(
  req: Request<unknown, unknown, ChangePasswordInput>,
  res: Response<SuccessResponse<{ token: string }>>,
) {
  const token = await userService.changePassword(req.user!.id, req.body);

  res.json({
    message: req.t('success.password_changed'),
    data: { token },
  });
}

export async function deleteUser(req: Request, res: Response<SuccessResponse<void>>) {
  const userId = req.user!.id;
  await userService.deleteUser(userId);

  const message = req.t('success.delete', { days: config.USER_DELETION_RETENTION_DAYS });

  res.json({
    message: message,
    data: undefined,
  });
}

export async function updateUser(
  req: Request<unknown, unknown, UpdateUserInput>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const userId = req.user!.id;
  const result = await userService.updateUser(userId, req.body);

  res.json({
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
    message: req.t('success.avatar_update'),
    data: result,
  });
}

export async function getUser(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const user = await userService.getUser(req.user!.id);

  res.json({ data: user });
}

export async function getUsers(
  req: Request,
  res: Response<SuccessResponse<UserResponse[], { pagination: PaginationMeta }>>,
) {
  // Express types the query as raw strings; validateQuery has replaced it with the parsed values
  const query = req.query as unknown as UserQueryInput;
  const { data, pagination } = await userService.getUsers(query);

  res.json({ data, meta: { pagination } });
}

export async function getUserById(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findById(req.params.id);

  res.json({ data: user });
}
