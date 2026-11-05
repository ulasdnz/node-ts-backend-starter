import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../lib/logger.js';
import { connectDB, disconnectDB } from '../../utils/db.js';
import { runMigrations } from './runner.js';
// Every model is imported here, so the index step below covers all of them
import '../../modules/user/user.model.js';
import '../plugins/audit-log.model.js';

const file = fileURLToPath(import.meta.url);
const extension = path.extname(file);

/**
 * The deploy step, run before the new version starts: `npm run migrate` from source,
 * `npm run migrate:prod` from the build. It applies pending migrations, then builds the indexes the
 * schemas declare. Index builds only add; dropping an index takes a migration of its own.
 */
const migrate = async (): Promise<void> => {
  if (extension !== '.ts' && extension !== '.js') {
    throw new Error(`Cannot tell migrations apart from ${extension} files`);
  }

  await connectDB();
  try {
    const applied = await runMigrations({
      connection: mongoose.connection,
      logger,
      directory: path.dirname(file),
      extension,
    });
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));

    logger.info('Database is up to date', {
      event: 'migration.completed',
      applied,
      indexedModels: Object.keys(mongoose.models),
    });
  } finally {
    await disconnectDB();
  }
};

// The process exits on its own once the connection is closed; exitCode marks the failure
migrate().catch((error: unknown) => {
  logger.error('Migration failed', {
    event: 'migration.failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
