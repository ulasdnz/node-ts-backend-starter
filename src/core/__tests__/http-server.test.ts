import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { closeHttpServer, listen } from '../http-server.js';

describe('listen', () => {
  it('leaves no error listener once listening', async () => {
    const app = express();
    const before = createServer(app).listenerCount('error');

    const server = await listen(app, 0);
    try {
      // A listener left behind would swallow every later server error
      expect(server.listenerCount('error')).toBe(before);
    } finally {
      await closeHttpServer(server);
    }
  });

  it('rejects when the port is taken', async () => {
    const first = await listen(express(), 0);
    try {
      const { port } = first.address() as AddressInfo;

      await expect(listen(express(), port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await closeHttpServer(first);
    }
  });
});
