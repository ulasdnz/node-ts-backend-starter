import { writeFileSync } from 'node:fs';
import path from 'node:path';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const name = process.argv[2];

if (!name || !NAME_PATTERN.test(name)) {
  console.error('Usage: npm run migration:create <name>, in kebab-case: backfill-user-locale');
  process.exit(1);
}

// YYYYMMDDHHMMSS in UTC, so the files sort, and run, in the order they were created
const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const fileName = `${timestamp}-${name}.ts`;
const filePath = path.join(process.cwd(), 'src', 'database', 'migrations', fileName);

const template = `import type { MigrationContext } from './runner.js';

/**
 * ${name}
 *
 * Runs once per database, in file name order, before the indexes are built. Work on collections
 * through \`db\` rather than models, so the migration still works after the models change. Keep it
 * safe to run again: a run that fails halfway starts over next time.
 */
export async function up({ db, logger }: MigrationContext): Promise<void> {
  // const { modifiedCount } = await db
  //   .collection('users')
  //   .updateMany({ locale: { $exists: false } }, { $set: { locale: 'en' } });

  logger.info('Applied ${name}', { event: 'migration.${name}' });
}
`;

// 'wx' refuses to overwrite an existing file
writeFileSync(filePath, template, { flag: 'wx' });
console.log(`Created src/database/migrations/${fileName}`);
