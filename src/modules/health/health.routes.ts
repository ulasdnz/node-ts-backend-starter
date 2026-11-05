import { Router, type Request, type Response } from 'express';
import type { Logger } from 'winston';
import type { HealthProbe } from './health.probes.js';
import type {
  HealthResponse,
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

  const runProbes = async (): Promise<Record<string, ServiceStatus>> => {
    const results = await Promise.allSettled(probes.map((probe) => probe.check()));

    return Object.fromEntries(
      probes.map((probe, index): [string, ServiceStatus] => {
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

  // Readiness asks "should traffic be routed here?": not while shutting down or with a dependency down
  router.get('/health/ready', async (_req: Request, res: Response<ReadinessResponse>) => {
    if (isShuttingDown()) {
      res.status(503).json({ ready: false });
      return;
    }

    const services = await runProbes();
    const ready = Object.values(services).every((status) => status === 'healthy');
    res.status(ready ? 200 : 503).json({ ready });
  });

  router.get('/health', async (_req: Request, res: Response<HealthResponse>) => {
    const services = await runProbes();
    const healthy =
      !isShuttingDown() && Object.values(services).every((status) => status === 'healthy');
    const { rss, heapUsed } = process.memoryUsage();

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: { rss: toMegabytes(rss), heapUsed: toMegabytes(heapUsed) },
      services,
    });
  });

  return router;
};
