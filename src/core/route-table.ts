import type { Express, Router } from 'express';
import type { IRoute } from 'express-serve-static-core';

/** A router with the path it is mounted at, as the application mounts it. */
export interface MountedRouter {
  base: string;
  router: Router;
}

// Express keeps the methods a route answers in `methods`, which its type definitions leave out
type RouteWithMethods = IRoute & { methods: Record<string, boolean | undefined> };

const toOpenApiPath = (path: string): string => path.replace(/:(\w+)/g, '{$1}');

// router.all() records its route under the method `_all`
const methodName = (method: string): string => (method === '_all' ? 'ALL' : method.toUpperCase());

/**
 * Every route of the given routers as `METHOD /full/path`, with path parameters written the OpenAPI
 * way (`/api/v1/users/{id}`), sorted. Read from the routers' own route tables, so it lists what the
 * routers really answer, however the routes were written.
 */
export const routeSignatures = (mounted: readonly MountedRouter[]): string[] =>
  mounted
    .flatMap(({ base, router }) =>
      router.stack.flatMap(({ route }) => {
        if (!route) return [];
        const { path, methods } = route as RouteWithMethods;
        return Object.keys(methods)
          .filter((method) => methods[method])
          .map((method) => `${methodName(method)} ${toOpenApiPath(`${base}${path}`)}`);
      }),
    )
    .sort();

/** The routers initExpress mounted, as it recorded them. */
export const mountedRoutersOf = (app: Express): readonly MountedRouter[] =>
  (app.locals.mountedRouters as readonly MountedRouter[] | undefined) ?? [];
