import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateQuery } from '../validate.js';

describe('validateQuery', () => {
  it('exposes the parsed query to the handler on Express 5', async () => {
    const app = express();
    app.get('/items', validateQuery(z.object({ page: z.coerce.number() })), (req, res) => {
      res.json({ page: req.query.page, type: typeof req.query.page });
    });

    const res = await request(app).get('/items?page=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: 2, type: 'number' });
  });
});
