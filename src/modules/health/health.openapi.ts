import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });

/** The body of GET /health (see health.types.ts). */
export const healthResponseSchema = z
  .object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']).meta({
      description: 'degraded: serving, with a non-critical dependency (Redis) down',
    }),
    timestamp: z.iso.datetime(),
    uptime: z.number().meta({ description: 'Seconds since the process started' }),
    memory: z.object({
      rss: z.number().meta({ description: 'Megabytes' }),
      heapUsed: z.number().meta({ description: 'Megabytes' }),
    }),
    services: z.record(z.string(), z.enum(['healthy', 'unhealthy'])),
  })
  .meta({ id: 'HealthResponse' });

const readiness = z.object({ ready: z.boolean() });

export const healthPaths: ZodOpenApiPathsObject = {
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'Every dependency, for inspection',
      security: [],
      responses: {
        200: { description: 'Healthy or degraded', ...json(healthResponseSchema) },
        503: {
          description: 'Unhealthy: a critical dependency is down, or the instance is shutting down',
          ...json(healthResponseSchema),
        },
      },
    },
  },
  '/health/ready': {
    get: {
      tags: ['Health'],
      summary: 'Readiness probe: should traffic be routed here?',
      security: [],
      responses: {
        200: { description: 'Ready', ...json(readiness) },
        503: { description: 'Not ready, or shutting down', ...json(readiness) },
      },
    },
  },
  '/health/live': {
    get: {
      tags: ['Health'],
      summary: 'Liveness probe: should the process be restarted?',
      security: [],
      responses: {
        200: { description: 'Alive', ...json(z.object({ alive: z.boolean() })) },
      },
    },
  },
};
