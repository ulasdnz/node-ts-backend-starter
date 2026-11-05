import { Router, type Request, type Response } from 'express';
import type { Logger } from 'winston';
import type { HealthProbe } from './health.probes.js';
import type {
  HealthResponse,
  HealthStatus,
  LivenessResponse,
  ReadinessResponse,
  ServiceStatus,
} from './health.types.js';

export interface HealthRouterOptions {
  probes: HealthProbe[];
  logger: Pick<Logger, 'warn'>;
  isShuttingDown: () => boolean;
}

const toMegabytes = (bytes: number): number => Math.round(bytes / 1024 / 1024);

export const createHealthRouter = ({
  probes,
  logger,
  isShuttingDown,
}: HealthRouterOptions): Router => {
  const router = Router();

  const criticalProbes = probes.filter((probe) => probe.critical !== false);

  const runProbes = async (selected: HealthProbe[]): Promise<Record<string, ServiceStatus>> => {
    const results = await Promise.allSettled(selected.map((probe) => probe.check()));

    return Object.fromEntries(
      selected.map((probe, index): [string, ServiceStatus] => {
        const result = results[index];
        if (result?.status !== 'rejected') return [probe.name, 'healthy'];

        logger.warn('Health probe failed', {
          event: 'health.probe.failed',
          probe: probe.name,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        return [probe.name, 'unhealthy'];
      }),
    );
  };

  // Liveness asks "should this process be restarted?". Draining requests during shutdown is the
  // process working as intended, so it stays alive until it exits.
  router.get('/health/live', (_req: Request, res: Response<LivenessResponse>) => {
    res.status(200).json({ alive: true });
  });

  // Readiness asks "should traffic be routed here?": not while shutting down or while a dependency
  // the API cannot work without is down
  router.get('/health/ready', async (_req: Request, res: Response<ReadinessResponse>) => {
    if (isShuttingDown()) {
      res.status(503).json({ ready: false });
      return;
    }

    const services = await runProbes(criticalProbes);
    const ready = Object.values(services).every((status) => status === 'healthy');
    res.status(ready ? 200 : 503).json({ ready });
  });

  // Every dependency: "degraded" means serving, but with a non-critical dependency down
  router.get('/health', async (_req: Request, res: Response<HealthResponse>) => {
    const services = await runProbes(probes);
    const criticalHealthy = criticalProbes.every((probe) => services[probe.name] === 'healthy');
    const allHealthy = Object.values(services).every((status) => status === 'healthy');
    const status: HealthStatus =
      isShuttingDown() || !criticalHealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded';
    const { rss, heapUsed } = process.memoryUsage();

    res.status(status === 'unhealthy' ? 503 : 200).json({
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: { rss: toMegabytes(rss), heapUsed: toMegabytes(heapUsed) },
      services,
    });
  });

  return router;
};
