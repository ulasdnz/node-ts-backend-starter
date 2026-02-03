import { logger } from '../../lib/logger.js';
import { connectDB, disconnectDB } from '../../utils/db.js';
import { seedUsers } from './user.seeder.js';

(async () => {
  try {
    await connectDB();
    logger.info('🌱 Starting all seeders...');
    await seedUsers();
    logger.info('✅ All seeders completed successfully');
  } catch (error) {
    logger.error('❌ Seeding failed:', error);
  } finally {
    await disconnectDB();
  }
})();
