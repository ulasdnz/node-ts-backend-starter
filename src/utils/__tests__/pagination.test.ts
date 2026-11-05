import mongoose, { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  softDeletePlugin,
  type SoftDeleteModel,
} from '../../database/plugins/soft-delete.plugin.js';
import { setupTestDatabase } from '../../test/helpers/database.js';
import { paginate, paginationSchema, parseSort } from '../pagination.js';

interface Listed {
  name?: string;
  createdAt?: Date;
  deleted: boolean;
  deletedAt: Date | null;
}

const listedSchema = new Schema<Listed>({ name: String, createdAt: Date });
listedSchema.plugin(softDeletePlugin);
const ListedModel = mongoose.model<Listed, SoftDeleteModel<Listed>>('Listed', listedSchema);

setupTestDatabase();

const SORTABLE = ['createdAt', 'name'];

describe('parseSort', () => {
  it('ends the sort with _id in the direction of the last key', () => {
    expect(Object.entries(parseSort('name,-createdAt', SORTABLE, { createdAt: -1 }))).toEqual([
      ['name', 1],
      ['createdAt', -1],
      ['_id', -1],
    ]);
  });

  it('ignores sort fields outside the allow list', () => {
    expect(parseSort('password,-name', SORTABLE, { createdAt: -1 })).toEqual({ name: -1, _id: -1 });
  });

  it('falls back to the default sort when no requested field is allowed', () => {
    expect(parseSort('password', SORTABLE, { createdAt: -1 })).toEqual({ createdAt: -1, _id: -1 });
    expect(parseSort(undefined, SORTABLE, { name: 1 })).toEqual({ name: 1, _id: 1 });
  });
});

describe('paginationSchema', () => {
  it('defaults to the first page of 20', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('rejects a limit above 100', () => {
    const result = paginationSchema.safeParse({ limit: '101' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('validation.limit_invalid');
  });

  it('rejects a page below 1', () => {
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('paginate', () => {
  const options = { allowedSortFields: SORTABLE, defaultSort: { createdAt: -1 as const } };

  it('walks every document exactly once across pages despite equal sort keys', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const created = await ListedModel.insertMany(
      Array.from({ length: 25 }, (_, index) => ({ name: `same-${index}`, createdAt })),
    );

    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await paginate(
        ListedModel.find(),
        { page, limit: 10, sort: '-createdAt' },
        options,
      );
      seen.push(...result.data.map((doc) => doc.id));
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen)).toEqual(new Set(created.map((doc) => doc.id)));
  });

  it('reports the page count', async () => {
    await ListedModel.insertMany(
      Array.from({ length: 25 }, (_, index) => ({ name: `n-${index}` })),
    );

    const result = await paginate(ListedModel.find(), { page: 3, limit: 10 }, options);

    expect(result.data).toHaveLength(5);
    expect(result.pagination).toEqual({ page: 3, limit: 10, total: 25, totalPages: 3 });
  });

  it('counts only active documents by default', async () => {
    const docs = await ListedModel.insertMany(['a', 'b', 'c', 'd', 'e'].map((name) => ({ name })));
    await ListedModel.softDeleteById(docs[0].id);
    await ListedModel.softDeleteById(docs[1].id);

    const result = await paginate(ListedModel.find(), { page: 1, limit: 10 }, options);

    expect(result.pagination.total).toBe(3);
    expect(result.data).toHaveLength(3);
  });

  it('includes soft-deleted documents when the query asks for them', async () => {
    const docs = await ListedModel.insertMany(['a', 'b', 'c'].map((name) => ({ name })));
    await ListedModel.softDeleteById(docs[0].id);

    const result = await paginate(
      ListedModel.find().withDeleted(),
      { page: 1, limit: 10 },
      options,
    );

    expect(result.pagination.total).toBe(3);
    expect(result.data).toHaveLength(3);
  });
});
