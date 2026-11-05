import mongoose from 'mongoose';
import type { EventEmitter } from 'node:events';
import type { Logger } from 'winston';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { connectDB } from '../../utils/db.js';
import { isShuttingDown } from '../shutdown.js';

interface WatchOptions {
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  isShuttingDown: () => boolean;
}

/**
 * Logs what happens to the connection after it opened. The driver reconnects on its own, so a lost
 * connection is a warning, and the one a shutdown closes on purpose is not worth one.
 */
export const watchConnection = (
  connection: EventEmitter,
  { logger: log, isShuttingDown: shuttingDown }: WatchOptions,
): void => {
  connection.on('disconnected', () => {
    if (shuttingDown()) return;
    log.warn('MongoDB disconnected, the driver keeps retrying', { event: 'mongodb.disconnected' });
  });
  connection.on('reconnected', () => {
    log.info('MongoDB reconnected', { event: 'mongodb.reconnected' });
  });
  connection.on('error', (error: unknown) => {
    log.error('MongoDB connection error', {
      event: 'mongodb.error',
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

/** Connects to MongoDB; indexes are built on start in development only. */
export const initMongoose = async (): Promise<void> => {
  await connectDB({ autoIndex: config.NODE_ENV === 'development' });
  watchConnection(mongoose.connection, { logger, isShuttingDown });
};
