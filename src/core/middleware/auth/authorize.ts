import type { NextFunction, Request, Response } from 'express';
import CustomError from '../../errors/index.js';

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new CustomError(403, 'auth.forbidden'));
    }

    next();
  };
};
