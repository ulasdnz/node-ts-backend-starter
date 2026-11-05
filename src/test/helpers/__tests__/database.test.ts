import mongoose, { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { setupTestDatabase } from '../database.js';

const Thing = mongoose.model(
  'IsolationThing',
  new Schema({ code: { type: String, unique: true } }),
);

setupTestDatabase();

describe('setupTestDatabase', () => {
  it('creates schema indexes so unique violations surface as E11000', async () => {
    await Thing.create({ code: 'a' });

    await expect(Thing.create({ code: 'a' })).rejects.toMatchObject({ code: 11000 });
  });

  it('starts every test with empty collections', async () => {
    expect(await Thing.countDocuments()).toBe(0);
  });

  it('gives each test file its own database', () => {
    expect(mongoose.connection.name).toMatch(/^test_[0-9a-f]{32}$/);
  });
});
