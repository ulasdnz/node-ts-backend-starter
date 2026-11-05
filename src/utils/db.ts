import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const SERVER_SELECTION_TIMEOUT_MS = 5000;

export interface ConnectOptions {
  /**
   * Builds missing indexes when models are compiled. Off by default: deployments build them in the
   * migrate step instead, so an app start never runs index builds against a production database.
   */
  autoIndex?: boolean;
}

/** Opens the default Mongoose connection; throws when MongoDB cannot be reached in time. */
export const connectDB = async ({ autoIndex = false }: ConnectOptions = {}): Promise<void> => {
  await mongoose.connect(config.MONGO_URI, {
    autoIndex,
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
  });
  logger.info('MongoDB connected', { event: 'mongodb.connected' });
};

/** Closes the default connection; a failure is the caller's to handle. */
export const disconnectDB = async (): Promise<void> => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed', { event: 'mongodb.closed' });
};
