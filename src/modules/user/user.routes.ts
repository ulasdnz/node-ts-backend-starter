import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth/authenticate.js';
import { authorize } from '../../core/middleware/auth/authorize.js';
import { upload } from '../../core/middleware/upload.js';
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js';
import * as userController from './user.controller.js';
import {
  loginSchema,
  registerSchema,
  updateUserSchema,
  userIdParamSchema,
  userQuerySchema,
} from './user.validators.js';

const router = Router();

router.post('/auth/register', validateBody(registerSchema), userController.register);
router.post('/auth/login', validateBody(loginSchema), userController.login);

router.get('/users/me', authenticate, userController.getUser);
router.patch('/users/me', authenticate, validateBody(updateUserSchema), userController.updateUser);
router.patch('/users/me/avatar', authenticate, upload.single('photo'), userController.updateAvatar);
router.delete('/users/me', authenticate, userController.deleteUser);

router.get(
  '/users',
  authenticate,
  authorize('admin'),
  validateQuery(userQuerySchema),
  userController.getUsers,
);

router.get(
  '/users/:id',
  authenticate,
  authorize('admin'),
  validateParams(userIdParamSchema),
  userController.getUserById,
);

export default router;
