import type { Logger } from 'winston';

export type ShutdownHook = () => Promise<void> | void;

export interface ShutdownOptions {
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  timeoutMs: number;
  exit: (code: number) => void;
}

export interface ShutdownManager {
  onShutdown(name: string, hook: ShutdownHook): void;
  isShuttingDown(): boolean;
  shutdown(reason: string, options: ShutdownOptions): Promise<void>;
}

/**
 * Coordinates graceful shutdown. Hooks run one at a time in reverse registration order: resources
 * register as they start (database, Redis, jobs, then the HTTP server), so they stop in the opposite
 * order and nothing is closed while something that started later still depends on it.
 */
export const createShutdownManager = (): ShutdownManager => {
  const hooks: { name: string; hook: ShutdownHook }[] = [];
  let shuttingDown = false;

  return {
    onShutdown(name, hook) {
      hooks.push({ name, hook });
    },

    isShuttingDown: () => shuttingDown,

    async shutdown(reason, { logger, timeoutMs, exit }) {
      if (shuttingDown) {
        logger.warn('Shutdown already in progress', { event: 'shutdown.duplicate', reason });
        return;
      }
      shuttingDown = true;
      logger.info('Shutting down', { event: 'shutdown.started', reason });

      // A hook that never settles must not keep the process past the platform's grace period
      const forceExit = setTimeout(() => {
        logger.error('Shutdown timed out, forcing exit', { event: 'shutdown.timeout', timeoutMs });
        exit(1);
      }, timeoutMs);
      forceExit.unref();

      let failed = false;
      for (const { name, hook } of [...hooks].reverse()) {
        try {
          await hook();
          logger.info('Shutdown hook completed', { event: 'shutdown.hook.completed', hook: name });
        } catch (error) {
          failed = true;
          logger.error('Shutdown hook failed', {
            event: 'shutdown.hook.failed',
            hook: name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      clearTimeout(forceExit);
      logger.info('Shutdown completed', { event: 'shutdown.completed', failed });
      exit(failed ? 1 : 0);
    },
  };
};

const processShutdown = createShutdownManager();

export const onShutdown = processShutdown.onShutdown;
export const isShuttingDown = processShutdown.isShuttingDown;
export const shutdown = processShutdown.shutdown;
