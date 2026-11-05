import type { Request } from 'express';

/**
 * The route a request matched as a pattern (`/api/v1/users/:id`), for logs and metrics: stable to
 * aggregate on and free of ids. Unmatched requests fall back to the path without its query string,
 * which may carry tokens.
 */
export const routePatternOf = (req: Request): string => {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return `${req.baseUrl}${route.path}`;

  return req.originalUrl.split('?')[0] ?? req.originalUrl;
};
