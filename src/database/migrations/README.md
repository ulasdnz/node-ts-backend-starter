# Migrations

Migrations change data that already exists: backfills, renames, index drops. They run as a deploy
step, before the new version of the app starts, and never at app startup.

## Commands

```bash
# Apply pending migrations, then build the indexes the schemas declare
npm run migrate          # from source
npm run migrate:prod     # from the build (dist/)

# Create a migration file from the template
npm run migration:create backfill-user-locale
# Creates src/database/migrations/20261105120000-backfill-user-locale.ts
```

## How a run works

1. **Lock.** A run takes the `lock` document in `migrations_lock`, so two deploys cannot apply the
   same migration twice. A second run fails with `MigrationLockedError` and a non-zero exit code. A
   lock older than ten minutes is treated as left behind by a crashed run and taken over.
2. **Apply.** Files are applied in name order, which is creation order thanks to the timestamp
   prefix. Each applied migration is recorded in the `migrations` collection by name, without its
   extension, so the same history serves `.ts` and compiled `.js` runs.
3. **Index.** `createIndexes()` runs for every model. It only adds indexes; dropping one takes a
   migration (see `20261105120100-drop-legacy-user-indexes.ts`).
4. **Unlock.** The lock is released whether the run succeeded or not.

## Writing a migration

```ts
import type { MigrationContext } from './runner.js';

export async function up({ db, logger }: MigrationContext): Promise<void> {
  const { modifiedCount } = await db
    .collection('users')
    .updateMany({ deleted: { $exists: false } }, { $set: { deleted: false, deletedAt: null } });

  logger.info('Backfilled soft-delete fields', {
    event: 'migration.users.backfilled',
    modifiedCount,
  });
}
```

- Use `db.collection(...)`, not models. A model describes the schema of today; a migration has to
  keep working against the data of the day it was written.
- Make it safe to run again. A migration that fails halfway is not recorded, so the next run starts
  it over.
- Migrations are forward-only: there is no `down()`. A mistake is fixed by a new migration.
