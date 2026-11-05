import type { Express } from 'express';
import type { Server } from 'node:http';

const IDLE_SWEEP_INTERVAL_MS = 100;

/**
 * Starts listening and resolves once the port is bound; a bind error (EADDRINUSE) rejects. The
 * error listener is removed once bound: left in place, it would swallow every later server error.
 */
export const listen = (app: Express, port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
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
