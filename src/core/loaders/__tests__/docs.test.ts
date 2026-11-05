import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountDocs } from '../docs.js';
import { initExpress } from '../express.js';

vi.mock('../../../lib/redis.js', async () => {
  const { createRedisMock } = await import('../../../test/helpers/redis-mock.js');
  const redisClient = createRedisMock();
  return { redisClient, createRedisClient: () => redisClient };
});

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
};
type Operation = {
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema: Record<string, unknown> }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }>;
};

const DOCUMENTED_OPERATIONS = [
  'DELETE /api/v1/users/me',
  'GET /api/v1/users',
  'GET /api/v1/users/me',
  'GET /api/v1/users/{id}',
  'GET /health',
  'GET /health/live',
  'GET /health/ready',
  'PATCH /api/v1/users/me',
  'PATCH /api/v1/users/me/avatar',
  'PATCH /api/v1/users/me/password',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
];

const operationsOf = (doc: OpenApiDocument) =>
  Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      signature: `${method.toUpperCase()} ${path}`,
      operation,
    })),
  );

let app: express.Express;
let doc: OpenApiDocument;

beforeAll(async () => {
  app = express();
  await mountDocs(app, { nodeEnv: 'development' });
  doc = (await request(app).get('/docs.json')).body as OpenApiDocument;
});

describe('the OpenAPI document', () => {
  it('serves the document at /docs.json', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(
      operationsOf(doc)
        .map(({ signature }) => signature)
        .sort(),
    ).toEqual(DOCUMENTED_OPERATIONS);
  });

  it('marks the protected operations, and only those, with BearerAuth', () => {
    for (const { signature, operation } of operationsOf(doc)) {
      const isProtected = signature.includes(' /api/v1/users');
      expect(operation.security, signature).toEqual(isProtected ? [{ BearerAuth: [] }] : []);
    }
  });

  it('documents page and limit as bounded integers', () => {
    const parameters = doc.paths['/api/v1/users']?.get?.parameters ?? [];
    const schemaOf = (name: string) =>
      parameters.find((parameter) => parameter.name === name && parameter.in === 'query')?.schema;

    expect(schemaOf('page')).toMatchObject({ type: 'integer', minimum: 1 });
    expect(schemaOf('limit')).toMatchObject({ type: 'integer', minimum: 1, maximum: 100 });
    expect(schemaOf('includeDeleted')).toMatchObject({ enum: ['true', 'false'] });
  });

  it('documents the email as an email string', () => {
    const body = doc.paths['/api/v1/auth/register']?.post?.requestBody?.content['application/json']
      ?.schema as { properties: Record<string, unknown> };

    expect(body.properties.email).toMatchObject({ type: 'string', format: 'email' });
  });

  it('declares the id path parameter as required', () => {
    const parameters = doc.paths['/api/v1/users/{id}']?.get?.parameters ?? [];

    expect(parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
  });

  it('documents the avatar upload as multipart with a binary photo', () => {
    const content = doc.paths['/api/v1/users/me/avatar']?.patch?.requestBody?.content;

    expect(Object.keys(content ?? {})).toEqual(['multipart/form-data']);
    expect(content?.['multipart/form-data']?.schema).toMatchObject({
      properties: { photo: { type: 'string', format: 'binary' } },
      required: ['photo'],
    });
  });

  it('points every error response at ErrorResponse', () => {
    for (const { signature, operation } of operationsOf(doc)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400 || signature.includes(' /health')) continue;
        expect(response.content?.['application/json']?.schema, `${signature} ${status}`).toEqual({
          $ref: '#/components/schemas/ErrorResponse',
        });
      }
    }
  });
});

describe('the docs endpoints', () => {
  it('serves Swagger UI outside production', async () => {
    const res = await request(app).get('/docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('has no Swagger UI in production', async () => {
    const production = express();
    await mountDocs(production, { nodeEnv: 'production' });

    expect((await request(production).get('/docs/')).status).toBe(404);
    expect((await request(production).get('/docs.json')).status).toBe(200);
  });

  it('are mounted by the application ahead of its 404 handler', async () => {
    const res = await request(await initExpress()).get('/docs.json');

    expect(res.status).toBe(200);
    expect((res.body as OpenApiDocument).openapi).toBe('3.1.0');
  });
});
