import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { routeSignatures } from '../route-table.js';

const handler: RequestHandler = (_req, res) => {
  res.end();
};

describe('routeSignatures', () => {
  it('lists a route that answers every method as ALL', () => {
    const router = Router();
    router.all('/ping', handler);

    expect(routeSignatures([{ base: '/api', router }])).toEqual(['ALL /api/ping']);
  });
});
