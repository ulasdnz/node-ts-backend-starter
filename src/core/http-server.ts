import type { Express } from 'express';
import type { Server } from 'node:http';

const IDLE_SWEEP_INTERVAL_MS = 100;

/** Starts listening and resolves once the port is bound; a bind error (EADDRINUSE) rejects. */
export const listen = (app: Express, port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });

/**
 * Stops accepting connections and resolves once every in-flight request has been answered.
 * Keep-alive connections are closed as soon as they go idle, so a client holding one open cannot
 * stretch shutdown to its keep-alive timeout.
 */
export const closeHttpServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_INTERVAL_MS);
    sweep.unref();

    server.close((error) => {
      clearInterval(sweep);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
