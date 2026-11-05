import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { closeHttpServer } from '../http-server.js';
import { createShutdownManager } from '../shutdown.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('graceful shutdown', () => {
  it('lets an in-flight request finish before closing the database', async () => {
    const events: string[] = [];
    const started = deferred();
    const release = deferred();

    const app = express();
    app.get('/slow', async (_req, res) => {
      started.resolve();
      await release.promise;
      events.push('response');
      res.send('done');
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const manager = createShutdownManager();
    const exit = vi.fn();
    manager.onShutdown('mongodb', () => {
      events.push('mongodb');
    });
    manager.onShutdown('http', async () => {
      await closeHttpServer(server);
      events.push('http');
    });

    const pending = fetch(`http://127.0.0.1:${port}/slow`);
    await started.promise;
    const stopping = manager.shutdown('SIGTERM', {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      timeoutMs: 5000,
      exit,
    });
    release.resolve();

    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('done');
    await stopping;
    expect(events).toEqual(['response', 'http', 'mongodb']);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
