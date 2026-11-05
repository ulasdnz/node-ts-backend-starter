import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../../lib/logger.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { up as backfillSoftDeleteFields } from '../20261105120000-backfill-user-soft-delete-fields.js';
import { up as dropLegacyUserIndexes } from '../20261105120100-drop-legacy-user-indexes.js';

setupTestDatabase();

const db = () => mongoose.connection.db!;
const users = () => db().collection('users');
const context = () => ({ db: db(), logger });

beforeEach(async () => {
  // No model owns the collection in this file, so the shared cleanup does not drop it
  if (await db().listCollections({ name: 'users' }).hasNext()) await db().dropCollection('users');
});

describe('backfill-user-soft-delete-fields', () => {
  it('adds the soft-delete fields to users that lack them', async () => {
    const deletedAt = new Date('2026-01-01T00:00:00Z');
    await users().insertMany([
      { email: 'legacy@example.com' },
      { email: 'gone@example.com', deleted: true, deletedAt },
    ]);

    await backfillSoftDeleteFields(context());

    expect(await users().findOne({ email: 'legacy@example.com' })).toMatchObject({
      deleted: false,
      deletedAt: null,
    });
    expect(await users().findOne({ email: 'gone@example.com' })).toMatchObject({
      deleted: true,
      deletedAt,
    });
  });

  it('changes nothing when run again', async () => {
    await users().insertOne({ email: 'legacy@example.com' });
    await backfillSoftDeleteFields(context());
    const before = await users().find().toArray();

    await backfillSoftDeleteFields(context());

    expect(await users().find().toArray()).toEqual(before);
  });
});

describe('drop-legacy-user-indexes', () => {
  const indexNames = async () => (await users().indexes()).map((index) => index.name).sort();

  it('drops the indexes the schema no longer declares', async () => {
    await users().createIndex({ deleted: 1 });
    await users().createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' });

    await dropLegacyUserIndexes(context());

    expect(await indexNames()).toEqual(['_id_']);
  });

  it('leaves other indexes and a database without the legacy ones alone', async () => {
    await expect(dropLegacyUserIndexes(context())).resolves.toBeUndefined();

    await users().createIndex({ email: 1 }, { unique: true });
    await dropLegacyUserIndexes(context());

    expect(await indexNames()).toEqual(['_id_', 'email_1']);
  });
});
