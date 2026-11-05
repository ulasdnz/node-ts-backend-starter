import { Router } from 'express';

/**
 * A Router that records where it is mounted. Express resets req.baseUrl once an error propagates out
 * of a router, so the error handler would otherwise log `/users/:id` instead of `/api/v1/users/:id`.
 * Use it for every router that defines routes.
 */
export const createRouter = (): Router => {
  const router = Router();
  router.use((req, res, next) => {
    res.locals.routeBase = req.baseUrl;
    next();
  });
  return router;
};
