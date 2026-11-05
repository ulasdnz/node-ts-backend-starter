import type { MigrationContext } from './runner.js';

/**
 * The deploy step builds the indexes the schemas declare, and only adds: dropping one takes a
 * migration. These two are no longer declared:
 * - `deleted_1`: a boolean that is false on nearly every user narrows no query and slows every write.
 * - `users_email_unique`: an earlier migration created it; the schema's own unique index on email
 *   (`email_1`) replaces it, and MongoDB refuses a second index on the same key under another name.
 */
const LEGACY_INDEXES = ['deleted_1', 'users_email_unique'];

export async function up({ db, logger }: MigrationContext): Promise<void> {
  if (!(await db.listCollections({ name: 'users' }).hasNext())) return;

  const users = db.collection('users');
  const existing = new Set((await users.indexes()).map((index) => index.name));

  for (const name of LEGACY_INDEXES.filter((index) => existing.has(index))) {
    await users.dropIndex(name);
    logger.info('Dropped legacy index', { event: 'migration.users.index_dropped', index: name });
  }
}
