import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { expect } from 'vitest';
import type { ZodType } from 'zod';
import { apiPaths } from '../../core/loaders/docs.js';
import { createOpenApiDocument } from '../../core/openapi.js';

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

// The document as clients download it from /docs.json. Zod's safeParse drops keys a schema does not
// list, so only the published JSON Schema shows a response carrying a field the document forbids.
const published = createOpenApiDocument(apiPaths);

// Schemas point at the document's components; registering those under their own id lets each
// response schema compile on its own
const DOCUMENT_ID = 'openapi';
const resolveRefs = (schema: unknown): object =>
  JSON.parse(
    JSON.stringify(schema).replaceAll('"#/components/', `"${DOCUMENT_ID}#/components/`),
  ) as object;

// Formats are left to the zod schemas, which check them too
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ $id: DOCUMENT_ID, components: resolveRefs(published.components) });
const validators = new Map<string, ValidateFunction>();

const publishedValidator = (
  method: HttpMethod,
  path: string,
  status: number,
): ValidateFunction | undefined => {
  const key = `${method} ${path} ${status}`;
  const known = validators.get(key);
  if (known) return known;

  const responses = published.paths?.[path]?.[method]?.responses;
  const schema = responses?.[String(status)]?.content?.['application/json']?.schema;
  if (schema === undefined) return undefined;

  const validate = ajv.compile(resolveRefs(schema));
  validators.set(key, validate);
  return validate;
};

/**
 * Checks a real response against the OpenAPI document: the operation must document the response's
 * status, and the body must match that response's schema, both as zod parses it and as the
 * published JSON Schema describes it. `path` is the documented template, such as
 * `/api/v1/users/{id}`.
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

  const validate = publishedValidator(method, path, res.status);
  expect(
    validate,
    `${signature} ${res.status} is missing from the published document`,
  ).toBeDefined();
  expect(
    validate?.(res.body),
    `${signature} ${res.status} breaks the published document: ${ajv.errorsText(validate?.errors)}`,
  ).toBe(true);
};
