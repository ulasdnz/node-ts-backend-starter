import type { MigrationContext } from './runner.js';

/**
 * Users created before soft delete existed have no `deleted` field. Every read filters on
 * `deleted: false`, which a missing field does not match, so those users would vanish from the app.
 */
export async function up({ db, logger }: MigrationContext): Promise<void> {
  const { modifiedCount } = await db
    .collection('users')
    .updateMany({ deleted: { $exists: false } }, { $set: { deleted: false, deletedAt: null } });

  logger.info('Backfilled soft-delete fields', {
    event: 'migration.users.soft_delete_backfilled',
    modified: modifiedCount,
  });
}
