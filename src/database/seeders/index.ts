import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { connectDB, disconnectDB } from '../../utils/db.js';
import { seedUsers } from './user.seeder.js';

/** `npm run seed`: replaces every user with development data, over a single connection. */
const seed = async (): Promise<void> => {
  if (config.NODE_ENV === 'production') {
    throw new Error('Seeding deletes every user and is disabled in production');
  }

  await connectDB();
  try {
    const { adminEmail } = await seedUsers();
    logger.info('Database seeded', { event: 'seed.completed', adminEmail });
  } finally {
    await disconnectDB();
  }
};

// The process exits on its own once the connection is closed; exitCode marks the failure
seed().catch((error: unknown) => {
  logger.error('Seeding failed', {
    event: 'seed.failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
