import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../../config/index.js';
import CustomError from '../../errors/index.js';

export interface JwtPayload {
  id: string;
  role: string;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new CustomError(401, 'auth.missing_header');
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;

    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new CustomError(401, 'auth.invalid_token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new CustomError(401, 'auth.token_expired'));
    } else {
      next(error);
    }
  }
}
