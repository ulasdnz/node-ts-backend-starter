import { config } from './config/index.js';
import { closeHttpServer, listen } from './core/http-server.js';
import { initLoaders } from './core/loaders/index.js';
import { onShutdown, shutdown } from './core/shutdown.js';
import { logger } from './lib/logger.js';

const errorFields = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

const stop = (reason: string, exitCode?: number): Promise<void> =>
  shutdown(reason, {
    logger,
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    exit: (code) => process.exit(exitCode ?? code),
  });

const start = async (): Promise<void> => {
  const app = await initLoaders();
  const server = await listen(app, config.PORT);
  onShutdown('http-server', () => closeHttpServer(server));

  logger.info('Server started', { event: 'server.started', port: config.PORT });
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));

// The process state is unknown after either of these, so it exits instead of carrying on
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    event: 'process.unhandled_rejection',
    ...errorFields(reason),
  });
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    event: 'process.uncaught_exception',
    ...errorFields(error),
  });
  process.exit(1);
});

start().catch((error: unknown) => {
  logger.error('Server failed to start', { event: 'server.start.failed', ...errorFields(error) });
  // Close whatever already started, then exit with a failure code however the cleanup went
  void stop('startup-failure', 1);
});
