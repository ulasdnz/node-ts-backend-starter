import mongoose from 'mongoose';
import { logger } from '../../lib/logger.js';

export async function up() {
  logger.info('Creating index on users.email...');

  await mongoose.connection
    .collection('users')
    .createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' });

  logger.info('✅ users.email index created');
}

export async function down() {
  logger.info('Dropping index on users.email...');

  await mongoose.connection.collection('users').dropIndex('users_email_unique');

  logger.info('🗑️ users.email index dropped');
}
