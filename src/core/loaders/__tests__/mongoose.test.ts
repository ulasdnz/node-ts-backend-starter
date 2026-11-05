import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { watchConnection } from '../mongoose.js';

const watch = (shuttingDown: boolean) => {
  const connection = new EventEmitter();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  watchConnection(connection, { logger, isShuttingDown: () => shuttingDown });
  return { connection, logger };
};

describe('watchConnection', () => {
  it('warns when MongoDB disconnects outside a shutdown', () => {
    const { connection, logger } = watch(false);

    connection.emit('disconnected');

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
      event: 'mongodb.disconnected',
    });
  });

  it('stays quiet about the disconnect a shutdown causes', () => {
    const { connection, logger } = watch(true);

    connection.emit('disconnected');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs reconnects and connection errors with an event', () => {
    const { connection, logger } = watch(false);

    connection.emit('reconnected');
    connection.emit('error', new Error('socket closed'));

    expect(logger.info).toHaveBeenCalledWith(expect.any(String), { event: 'mongodb.reconnected' });
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), {
      event: 'mongodb.error',
      error: 'socket closed',
    });
  });
});
