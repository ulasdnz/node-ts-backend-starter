import { expect } from 'vitest';
import type { ZodType } from 'zod';
import { apiPaths } from '../../core/loaders/docs.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Every operation the OpenAPI document describes, as `METHOD /full/path`, sorted. */
export const documentedSignatures = (): string[] =>
  Object.entries(apiPaths)
    .flatMap(([path, item]) =>
      HTTP_METHODS.filter((method) => item?.[method]).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    )
    .sort();

const isZodSchema = (value: unknown): value is ZodType =>
  typeof (value as Partial<ZodType> | undefined)?.safeParse === 'function';

/**
 * Checks a real response against the OpenAPI document: the operation must document the response's
 * status, and the body must match that response's schema. `path` is the documented template, such
 * as `/api/v1/users/{id}`.
 */
export const expectDocumentedResponse = (
  res: { status: number; body: unknown },
  method: HttpMethod,
  path: string,
): void => {
  const operation = apiPaths[path]?.[method];
  const signature = `${method.toUpperCase()} ${path}`;
  expect(operation, `${signature} is not documented`).toBeDefined();

  const responses = (operation?.responses ?? {}) as Record<string, unknown>;
  const response = responses[String(res.status)] as
    { content?: Record<string, { schema?: unknown }> } | undefined;
  expect(response, `${signature} does not document a ${res.status} response`).toBeDefined();

  const schema = response?.content?.['application/json']?.schema;
  expect(isZodSchema(schema), `${signature} ${res.status} has no JSON schema`).toBe(true);

  const result = (schema as ZodType).safeParse(res.body);
  expect(
    result.success,
    `${signature} ${res.status} does not match the document: ${result.error?.message ?? ''}`,
  ).toBe(true);
};
