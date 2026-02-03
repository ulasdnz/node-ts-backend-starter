import { MongoServerError } from 'mongodb';
import mongoose, { Schema, Types } from 'mongoose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  softDeletePlugin,
  type SoftDeleteDocument,
  type SoftDeleteModel,
} from '../softDelete.plugin.js';

interface ITestDoc extends SoftDeleteDocument {
  name: string;
  value: number;
}

let TestModel: SoftDeleteModel<ITestDoc>;

describe('softDeletePlugin', () => {
  beforeAll(async () => {
    const testSchema = new Schema<ITestDoc>({
      name: { type: String, required: true },
      value: { type: Number, default: 0 },
    });
    testSchema.plugin(softDeletePlugin);

    TestModel =
      (mongoose.models.SoftDeleteTest as SoftDeleteModel<ITestDoc>) ||
      mongoose.model<ITestDoc, SoftDeleteModel<ITestDoc>>('SoftDeleteTest', testSchema);
  });

  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.connection.collection('softdeletetests').deleteMany({});
      } catch {
        // Collection might not exist yet
      }
    }
  });

  describe('Schema Additions', () => {
    it('should add deleted and deletedAt fields with correct defaults', async () => {
      const doc = await TestModel.create({ name: 'test' });
      expect(doc.deleted).toBe(false);
      expect(doc.deletedAt).toBeNull();
    });
  });

  describe('Query Helpers', () => {
    beforeEach(async () => {
      await TestModel.create({ name: 'active1' });
      await mongoose.connection.collection('softdeletetests').insertOne({
        name: 'deleted1',
        value: 0,
        deleted: true,
        deletedAt: new Date(),
      });
    });

    it('withDeleted() should return all documents including deleted ones', async () => {
      const docs = await TestModel.find().withDeleted();
      expect(docs).toHaveLength(2);
    });

    it('onlyDeleted() should return only soft-deleted documents', async () => {
      const docs = await TestModel.find().onlyDeleted();
      expect(docs).toHaveLength(1);
      expect(docs[0].deleted).toBe(true);
    });
  });

  describe('Find Hook (Auto-filter)', () => {
    beforeEach(async () => {
      await TestModel.create({ name: 'active1' });
      await mongoose.connection.collection('softdeletetests').insertOne({
        name: 'deleted1',
        value: 0,
        deleted: true,
        deletedAt: new Date(),
      });
    });

    it('should exclude soft-deleted documents by default', async () => {
      const docs = await TestModel.find();
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('active1');
    });

    it('should NOT auto-filter when query explicitly sets deleted', async () => {
      const docs = await TestModel.find({ deleted: true });
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('deleted1');
    });
  });

  describe('Hard Delete Prevention', () => {
    beforeEach(async () => {
      await TestModel.create({ name: 'test' });
    });

    it('should throw error on deleteOne', async () => {
      await expect(TestModel.deleteOne({ name: 'test' })).rejects.toThrow(
        'Hard delete is disabled. Use softDeleteById() instead.',
      );
    });

    it('should throw error on deleteMany', async () => {
      await expect(TestModel.deleteMany({})).rejects.toThrow(
        'Hard delete is disabled. Use soft delete methods instead.',
      );
    });

    it('should throw error on findOneAndDelete', async () => {
      await expect(TestModel.findOneAndDelete({ name: 'test' })).rejects.toThrow(
        'Hard delete is disabled. Use softDeleteById() instead.',
      );
    });
  });

  describe('Instance Methods', () => {
    it('restore() should restore a soft-deleted document', async () => {
      const doc = await TestModel.create({ name: 'toRestore' });
      await TestModel.softDeleteById(doc._id.toString());

      const deletedDoc = await TestModel.findById(doc._id).withDeleted();
      expect(deletedDoc!.deleted).toBe(true);

      const restoredDoc = await deletedDoc!.restore();
      expect(restoredDoc.deleted).toBe(false);
      expect(restoredDoc.deletedAt).toBeNull();
    });
  });

  describe('Static Methods', () => {
    it('softDeleteById() should soft delete a document', async () => {
      const doc = await TestModel.create({ name: 'toDelete' });
      const deletedDoc = await TestModel.softDeleteById(doc._id.toString());

      expect(deletedDoc!.deleted).toBe(true);
      expect(deletedDoc!.deletedAt).toBeInstanceOf(Date);
    });

    it('restoreById() should restore a soft-deleted document', async () => {
      const doc = await TestModel.create({ name: 'toRestore' });
      await TestModel.softDeleteById(doc._id.toString());
      const restoredDoc = await TestModel.restoreById(doc._id.toString());

      expect(restoredDoc!.deleted).toBe(false);
      expect(restoredDoc!.deletedAt).toBeNull();
    });

    it('countActive() should count only non-deleted documents', async () => {
      await TestModel.create({ name: 'active1' });
      await TestModel.create({ name: 'active2' });
      const toDelete = await TestModel.create({ name: 'deleted1' });
      await TestModel.softDeleteById(toDelete._id.toString());

      const count = await TestModel.countActive();
      expect(count).toBe(2);
    });

    it('updateManyActive() should update only non-deleted documents', async () => {
      await TestModel.create({ name: 'active1', value: 0 });
      const toDelete = await TestModel.create({ name: 'deleted1', value: 0 });
      await TestModel.softDeleteById(toDelete._id.toString());

      const result = await TestModel.updateManyActive({}, { $set: { value: 100 } });
      expect(result.modifiedCount).toBe(1);
    });

    it('updateManyWithDeleted() should update all documents including deleted', async () => {
      await TestModel.create({ name: 'active1', value: 0 });
      const toDelete = await TestModel.create({ name: 'deleted1', value: 0 });
      await TestModel.softDeleteById(toDelete._id.toString());

      const result = await TestModel.updateManyWithDeleted({}, { $set: { value: 100 } });
      expect(result.modifiedCount).toBe(2);
    });

    describe('aggregateSafe()', () => {
      beforeEach(async () => {
        await TestModel.create({ name: 'active1', value: 10 });
        const toDelete = await TestModel.create({ name: 'deleted1', value: 30 });
        await TestModel.softDeleteById(toDelete._id.toString());
      });

      it('should add deleted:false match for empty pipeline', async () => {
        const results = await TestModel.aggregateSafe([]);
        expect(results).toHaveLength(1);
        expect(results[0].deleted).toBe(false);
      });

      it('should prepend deleted:false match to default aggregation', async () => {
        const results = await TestModel.aggregateSafe([{ $match: { value: { $gte: 10 } } }]);
        expect(results).toHaveLength(1);
        expect(results.find((r: ITestDoc) => r.name === 'deleted1')).toBeUndefined();
      });

      it('should inject deleted:false into $geoNear query', async () => {
        const geoSchema = new Schema({
          name: String,
          location: { type: { type: String }, coordinates: [Number] },
        });
        geoSchema.plugin(softDeletePlugin);
        geoSchema.index({ location: '2dsphere' });

        if (mongoose.models.GeoTest) {
          delete mongoose.models.GeoTest;
        }

        const GeoModel = mongoose.model(
          'GeoTest',
          geoSchema,
        ) as unknown as SoftDeleteModel<unknown>;

        await GeoModel.syncIndexes();

        await GeoModel.create({
          name: 'point1',
          location: { type: 'Point', coordinates: [0, 0] },
        });

        const toDelete = await GeoModel.create({
          name: 'point2',
          location: { type: 'Point', coordinates: [0.001, 0.001] },
        });
        await GeoModel.softDeleteById((toDelete as { _id: Types.ObjectId })._id.toString());

        const results = await GeoModel.aggregateSafe([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [0, 0] },
              distanceField: 'distance',
              spherical: true,
            },
          },
        ]);

        expect(results).toHaveLength(1);

        try {
          await mongoose.connection.dropCollection('geotests');
          delete mongoose.models.GeoTest;
        } catch {
          // Collection might not exist
        }
      });

      it('should pass through $search pipeline unchanged', async () => {
        try {
          await TestModel.aggregateSafe([
            { $search: { text: { query: 'test', path: 'name' } } },
          ] as Parameters<typeof TestModel.aggregateSafe>[0]);
        } catch (e: unknown) {
          const err = e as MongoServerError;

          expect(err.code).toBe(31082);
          expect(err.codeName).toBe('SearchNotEnabled');
        }
      });

      it('should pass through $vectorSearch pipeline unchanged', async () => {
        try {
          await TestModel.aggregateSafe([
            {
              $vectorSearch: {
                queryVector: [0.1],
                path: 'embedding',
                numCandidates: 10,
                limit: 5,
                index: 'idx',
              },
            },
          ] as Parameters<typeof TestModel.aggregateSafe>[0]);
        } catch (e: unknown) {
          const err = e as MongoServerError;

          expect(err.code).toBe(31082);
          expect(err.codeName).toBe('SearchNotEnabled');
        }
      });

      it('should pass through $searchMeta pipeline unchanged', async () => {
        try {
          await TestModel.aggregateSafe([
            { $searchMeta: { facet: { operator: { text: { query: 'test', path: 'name' } } } } },
          ] as Parameters<typeof TestModel.aggregateSafe>[0]);
        } catch (e: unknown) {
          const err = e as MongoServerError;

          expect(err.code).toBe(31082);
          expect(err.codeName).toBe('SearchNotEnabled');
        }
      });
    });
  });
});
