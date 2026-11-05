import type { Express } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import type { Config } from '../../config/index.js';
import { healthPaths } from '../../modules/health/health.openapi.js';
import { userPaths } from '../../modules/user/user.openapi.js';
import { createOpenApiDocument } from '../openapi.js';

/** Every operation the application serves, as the OpenAPI document describes it. */
export const apiPaths: ZodOpenApiPathsObject = { ...healthPaths, ...userPaths };

/**
 * Serves the OpenAPI document at /docs.json in every environment, and Swagger UI at /docs outside
 * production. Swagger UI is loaded only when it is served, so production never imports it.
 */
export const mountDocs = async (
  app: Express,
  { nodeEnv }: { nodeEnv: Config['NODE_ENV'] },
): Promise<void> => {
  const document = createOpenApiDocument(apiPaths);
  app.get('/docs.json', (_req, res) => {
    res.json(document);
  });

  if (nodeEnv === 'production') return;

  const { default: swaggerUi } = await import('swagger-ui-express');
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(document));
};
