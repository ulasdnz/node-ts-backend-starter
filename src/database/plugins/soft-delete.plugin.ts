import {
  Document,
  Model,
  mongo,
  type MongooseUpdateQueryOptions,
  type PipelineStage,
  Query,
  type QueryFilter,
  Schema,
  Types,
  type UpdateQuery,
  type UpdateWithAggregationPipeline,
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

type Filter = QueryFilter<Record<string, unknown>>;
type Update = UpdateQuery<Record<string, unknown>> | UpdateWithAggregationPipeline;
type UpdateOptions = mongo.UpdateOptions & MongooseUpdateQueryOptions;

const ACTIVE_ONLY: PipelineStage.Match = { $match: { deleted: false } };

export interface SoftDeleteModel<T> extends Model<T, SoftDeleteQueryHelpers> {
  softDeleteById(id: string): Promise<T | null>;

  restoreById(id: string): Promise<T | null>;

  countActive(filter?: Filter): Promise<number>;

  updateManyActive(
    filter: Filter,
    update: Update,
    options?: UpdateOptions,
  ): Promise<UpdateWriteOpResult>;

  updateManyWithDeleted(
    filter: Filter,
    update: Update,
    options?: UpdateOptions,
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
  schema.statics.softDeleteById = function (id: string) {
    return this.findByIdAndUpdate(
      id,
      {
        deleted: true,
        deletedAt: new Date(),
      },
      { returnDocument: 'after' },
    );
  };

  schema.statics.restoreById = function (id: string) {
    return this.findByIdAndUpdate(
      id,
      {
        deleted: false,
        deletedAt: null,
      },
      { returnDocument: 'after', withDeleted: true },
    );
  };

  schema.statics.countActive = function (
    this: Model<Record<string, unknown>>,
    filter: Filter = {},
  ) {
    return this.countDocuments({ ...filter, deleted: false });
  };

  schema.statics.updateManyActive = function (
    this: Model<Record<string, unknown>>,
    filter: Filter,
    update: Update,
    options?: UpdateOptions,
  ) {
    return this.updateMany({ ...filter, deleted: false }, update, options);
  };

  schema.statics.updateManyWithDeleted = function (
    this: Model<Record<string, unknown>>,
    filter: Filter,
    update: Update,
    options?: UpdateOptions,
  ) {
    return this.updateMany(filter, update, options);
  };

  schema.statics.aggregateSafe = function (
    this: Model<Record<string, unknown>>,
    pipeline: PipelineStage[] = [],
  ) {
    const [firstStage, ...rest] = pipeline;
    if (!firstStage) return this.aggregate([ACTIVE_ONLY]);

    // $geoNear has to be the first stage, so the filter goes into its own query
    if ('$geoNear' in firstStage) {
      const { $geoNear } = firstStage;
      return this.aggregate([
        { $geoNear: { ...$geoNear, query: { ...$geoNear.query, deleted: false } } },
        ...rest,
      ]);
    }

    // Atlas Search stages have to come first as well; filtering their results is the caller's job
    if ('$search' in firstStage || '$vectorSearch' in firstStage || '$searchMeta' in firstStage) {
      return this.aggregate(pipeline);
    }

    return this.aggregate([ACTIVE_ONLY, ...pipeline]);
  };
}
