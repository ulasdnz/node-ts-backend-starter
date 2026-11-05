import {
  Document,
  Model,
  type PipelineStage,
  Query,
  Schema,
  Types,
  type UpdateWriteOpResult,
} from 'mongoose';

export interface SoftDeleteDocument extends Document {
  _id: Types.ObjectId;
  deleted: boolean;
  deletedAt: Date | null;
  restore(): Promise<this>;
}

interface ISoftDelete {
  deleted: boolean;
  deletedAt: Date | null;
}
type SoftDeleted<T> = T & ISoftDelete;

interface SoftDeleteQueryHelpers {
  withDeleted(): this;
  onlyDeleted(): this;
}

type SoftDeleteQuery<T> = Query<SoftDeleted<T>[], SoftDeleted<T>> & SoftDeleteQueryHelpers;

export interface SoftDeleteModel<T> extends Model<T, SoftDeleteQueryHelpers> {
  softDeleteById(id: string): Promise<T | null>;

  restoreById(id: string): Promise<T | null>;

  countActive(filter?: Record<string, unknown>): Promise<number>;

  updateManyActive(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<UpdateWriteOpResult>;

  updateManyWithDeleted(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<UpdateWriteOpResult>;

  aggregateSafe(pipeline?: PipelineStage[]): Promise<T[]>;
}

export function softDeletePlugin(schema: Schema) {
  schema.add({
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  });

  // No index on `deleted` alone: nearly every document has the same value, so it narrows nothing
  // and only costs writes. The purge job finds expired documents through this partial index.
  schema.index(
    { deletedAt: 1 },
    {
      name: 'idx_soft_delete_cleanup',
      partialFilterExpression: { deleted: true },
    },
  );

  (schema.query as SoftDeleteQuery<unknown>).withDeleted = function () {
    this.setOptions({ withDeleted: true });
    return this;
  };

  (schema.query as SoftDeleteQuery<unknown>).onlyDeleted = function () {
    this.where({ deleted: true });
    this.setOptions({ withDeleted: true });
    return this;
  };

  // Reads see active documents only, unless the query opts out with withDeleted() or filters on
  // `deleted` itself. estimatedDocumentCount() reads collection metadata and cannot be filtered.
  function excludeSoftDeleted(this: Query<unknown, unknown>) {
    if (this.getOptions().withDeleted) return;

    if (this.getQuery().deleted === undefined) {
      this.where({ deleted: false });
    }
  }

  schema.pre(/^find/, excludeSoftDeleted);
  schema.pre(['countDocuments', 'distinct'], excludeSoftDeleted);

  // Document deleteOne() runs through this query hook as well, so it is blocked too
  schema.pre('deleteOne', { document: false, query: true }, function () {
    throw new Error('Hard delete is disabled. Use softDeleteById() instead.');
  });

  schema.pre('deleteMany', { document: false, query: true }, function () {
    throw new Error('Hard delete is disabled. Use soft delete methods instead.');
  });

  schema.pre(/^findOneAndDelete/, function () {
    throw new Error('Hard delete is disabled. Use softDeleteById() instead.');
  });

  schema.methods.restore = async function (this: SoftDeleteDocument) {
    this.deleted = false;
    this.deletedAt = null;
    return this.save();
  };
  schema.statics.softDeleteById = function (id) {
    return this.findByIdAndUpdate(
      id,
      {
        deleted: true,
        deletedAt: new Date(),
      },
      { returnDocument: 'after' },
    );
  };

  schema.statics.restoreById = function (id) {
    return this.findByIdAndUpdate(
      id,
      {
        deleted: false,
        deletedAt: null,
      },
      { returnDocument: 'after', withDeleted: true },
    );
  };

  schema.statics.countActive = function (filter = {}) {
    return this.countDocuments({
      ...filter,
      deleted: false,
    });
  };

  schema.statics.updateManyActive = function (filter, update, options = {}) {
    return this.updateMany(
      {
        ...filter,
        deleted: false,
      },
      update,
      options,
    );
  };

  schema.statics.updateManyWithDeleted = function (filter, update, options = {}) {
    return this.updateMany(filter, update, options);
  };

  schema.statics.aggregateSafe = function (pipeline = []) {
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      return this.aggregate([{ $match: { deleted: false } }]);
    }

    const [firstStage, ...rest] = pipeline;

    // $geoNear → soft delete MUST be inside query
    if (firstStage.$geoNear) {
      const geoNear = firstStage.$geoNear;

      return this.aggregate([
        {
          $geoNear: {
            ...geoNear,
            query: {
              ...(geoNear.query || {}),
              deleted: false,
            },
          },
        },
        ...rest,
      ]);
    }

    // $search / vectorSearch → consciously skipped
    if (firstStage.$search || firstStage.$vectorSearch || firstStage.$searchMeta) {
      return this.aggregate(pipeline);
    }

    // default aggregation
    return this.aggregate([{ $match: { deleted: false } }, ...pipeline]);
  };
}
