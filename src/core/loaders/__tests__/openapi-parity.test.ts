import type { Express } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { documentedSignatures } from '../../../test/helpers/openapi.js';
import { mountedRoutersOf, routeSignatures } from '../../route-table.js';
import { initExpress } from '../express.js';

vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const redisClient = createRedisMock();
  return { redisClient, createRedisClient: () => redisClient };
});

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

  it('records the health router and the user router with their mount points', () => {
    expect(mountedRoutersOf(app).map(({ base }) => base)).toEqual(['', '/api/v1']);
  });
});
