import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from '../../lib/logger.js';
import { connectDB, disconnectDB } from '../../utils/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname);

export async function runMigrations() {
  await connectDB();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort();

  for (const file of files) {
    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const migration = await import(pathToFileURL(migrationPath).href);

    if (migration.up) {
      logger.info(`🚀 Running migration: ${file}`);
      await migration.up();
      logger.info(`✅ Migration completed: ${file}`);
    }
  }

  await disconnectDB();
  logger.info('🏁 All migrations completed');
}

if (process.argv[1] === __filename) {
  runMigrations().then(() => process.exit(0));
}
