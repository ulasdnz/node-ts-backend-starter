import type { Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';

export const validateBody =
  (schema: ZodType): RequestHandler =>
  async (req, _res, next) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

export const validateParams =
  (schema: ZodType): RequestHandler =>
  async (req, _res, next) => {
    try {
      req.params = (await schema.parseAsync(req.params)) as Request['params'];
      next();
    } catch (error) {
      next(error);
    }
  };

export const validateQuery =
  (schema: ZodType): RequestHandler =>
  async (req, _res, next) => {
    try {
      const query = await schema.parseAsync(req.query);
      // Express 5 exposes req.query through a getter, so the parsed value has to be defined over it
      Object.defineProperty(req, 'query', {
        value: query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
