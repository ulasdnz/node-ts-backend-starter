import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import '../provided-context.js';

/**
 * Connects the calling test file to a database of its own on the shared in-memory MongoDB.
 *
 * Indexes of every model registered at connect time are built before the first test, so unique
 * constraints fail the way they do in production. Collections are emptied after each test and the
 * database is dropped once the file is done.
 */
export function setupTestDatabase(): void {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), {
      dbName: `test_${randomUUID().replaceAll('-', '')}`,
    });
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  });

  afterEach(async () => {
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
