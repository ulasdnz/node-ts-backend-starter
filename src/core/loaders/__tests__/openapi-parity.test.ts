import type { Express, Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { documentedSignatures } from '../../../test/helpers/openapi.js';
import { mountedRoutersOf, routeSignatures } from '../../route-table.js';
import { initExpress } from '../express.js';

vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const redisClient = createRedisMock();
  return { redisClient, createRedisClient: () => redisClient };
});

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const SAMPLE_ID = '0123456789abcdef01234567';

const isRouter = (handle: unknown): handle is Router =>
  typeof handle === 'function' && Array.isArray((handle as Partial<Router>).stack);

// Every router mounted below `router`, at any depth, that defines routes of its own
const routersWithRoutes = (router: Router): Router[] =>
  router.stack.flatMap(({ handle }) => {
    if (!isRouter(handle)) return [];
    const nested = routersWithRoutes(handle);
    return handle.stack.some(({ route }) => route) ? [handle, ...nested] : nested;
  });

// Express 5 exposes the application's own router as app.router
const appRouter = (application: Express): Router =>
  (application as unknown as { router: Router }).router;

let app: Express;

beforeAll(async () => {
  app = await initExpress();
});

// Reads the routes off the routers the application really mounts, so a route cannot hide from the
// comparison behind an unusual way of writing it
describe('the OpenAPI document and the routes', () => {
  it('documents every route the app serves', () => {
    const documented = documentedSignatures();

    const undocumented = routeSignatures(mountedRoutersOf(app)).filter(
      (route) => !documented.includes(route),
    );

    expect(undocumented).toEqual([]);
  });

  it('serves every route the document describes', () => {
    const served = routeSignatures(mountedRoutersOf(app));

    const unserved = documentedSignatures().filter((route) => !served.includes(route));

    expect(unserved).toEqual([]);
  });

  // The comparison above trusts the record of mounted routers; these keep the record honest
  it('records every router that serves routes', () => {
    const recorded = mountedRoutersOf(app).map(({ router }) => router);

    const unrecorded = routersWithRoutes(appRouter(app)).filter(
      (router) => !recorded.includes(router),
    );

    expect(unrecorded, 'a router serves routes the comparison never sees').toHaveLength(0);
  });

  it('serves no route of its own besides the document', () => {
    expect(routeSignatures([{ base: '', router: appRouter(app) }])).toEqual(['GET /docs.json']);
  });

  it('answers every documented operation at its documented path', async () => {
    const unanswered: string[] = [];

    for (const signature of documentedSignatures()) {
      const [method = '', path = ''] = signature.split(' ');
      const res = await request(app)[method.toLowerCase() as HttpMethod](
        path.replaceAll(/\{\w+\}/g, SAMPLE_ID),
      );
      const body = res.body as { error?: { code?: string } };
      if (body.error?.code === 'error.route_not_found') unanswered.push(signature);
    }

    expect(unanswered).toEqual([]);
  });
});
