import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  createDocument,
  type oas31,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';

/** The body of every error response (see the error handler). */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({
        description: 'Stable, machine-readable code; clients branch on this, never on message',
        example: 'auth.invalid_credentials',
      }),
      message: z.string().meta({ description: "Human-readable message in the request's language" }),
      details: z
        .array(z.object({ field: z.string(), message: z.string() }))
        .optional()
        .meta({ description: 'One entry per invalid or disallowed field' }),
      traceId: z.string().optional().meta({ description: 'Same value as the X-Trace-Id header' }),
      stack: z.string().optional().meta({ description: 'Development only' }),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export const paginationMetaSchema = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'PaginationMeta' });

/** Security requirement of operations that need a bearer token. */
export const bearerAuth = [{ BearerAuth: [] }];

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500;

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'Malformed JSON, or values that fail validation',
  401: 'Missing, invalid, expired or revoked token, or wrong credentials',
  403: 'Disabled account, or a role this operation does not allow',
  404: 'Not found',
  409: 'Conflicts with an existing resource',
  413: 'Request body too large',
  429: 'Too many requests or failed attempts; Retry-After says when to try again',
  500: 'Unexpected error; the trace id finds it in the logs',
};

/** The error responses an operation can return, all in the ErrorResponse shape. */
export const errorResponses = (...statuses: ErrorStatus[]): ZodOpenApiResponsesObject =>
  Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: ERROR_DESCRIPTIONS[status],
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    ]),
  );

const packageVersion = (): string => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return (manifest as { version: string }).version;
};

/**
 * The OpenAPI 3.1 document of the given paths. Paths are written in full (`/api/v1/...`,
 * `/health`), because the health endpoints live outside `/api`.
 */
export const createOpenApiDocument = (paths: ZodOpenApiPathsObject): oas31.OpenAPIObject =>
  createDocument({
    openapi: '3.1.0',
    info: {
      title: 'node-ts-backend-starter API',
      version: packageVersion(),
      description:
        'Errors share one shape (ErrorResponse) and carry a stable `code`. Every response has an ' +
        'X-Trace-Id header that finds the request in the logs.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The token from sign-in, a password change or a restore',
        },
      },
    },
    paths,
  });
