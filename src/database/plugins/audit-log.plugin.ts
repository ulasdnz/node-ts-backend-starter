import { Document, type Query, type Schema, Types } from 'mongoose';
import { getContext } from '../../core/middleware/request-context.js';
import { logger } from '../../lib/logger.js';
import { AuditLog, type AuditOperation } from './audit-log.model.js';

interface AuditEntry {
  operation: AuditOperation;
  model: string;
  documentId: string;
  changes: unknown;
}

interface PendingSave {
  wasNew: boolean;
  changes: Record<string, unknown> | null;
}

const PENDING_SAVE = 'auditLog.pendingSave';
const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'accessToken', 'refreshToken']);
const REDACTED = '[REDACTED]';

const pendingWrites = new Set<Promise<void>>();

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// Keys are matched on their last segment, so a saved path or an update key such as
// 'credentials.token' is masked as well
const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEYS.has(key.slice(key.lastIndexOf('.') + 1));

const mask = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(mask);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? REDACTED : mask(nested),
    ]),
  );
};

// The stored state, not the API view: schema transforms, getters and virtuals are left out
const snapshot = (doc: Document): Record<string, unknown> =>
  doc.toObject({
    depopulate: true,
    flattenMaps: true,
    getters: false,
    transform: false,
    versionKey: false,
    virtuals: false,
  });

const valueAt = (source: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);

const changedPaths = (doc: Document): Record<string, unknown> | null => {
  const paths = doc.directModifiedPaths();
  if (paths.length === 0) return null;

  const state = snapshot(doc);
  return Object.fromEntries(paths.map((path) => [path, valueAt(state, path)]));
};

const currentActor = () => {
  const context = getContext();
  return {
    userId: context ? (context.userId ?? 'anonymous') : 'system',
    traceId: context?.traceId ?? null,
    ip: context?.ip ?? null,
  };
};

// Fire and forget: an audit entry that cannot be written is logged, never thrown at the operation
// it describes
const record = (entry: AuditEntry): void => {
  const actor = currentActor();
  const write: Promise<void> = Promise.resolve()
    .then(async () => {
      await AuditLog.create({ ...entry, changes: mask(entry.changes), actor });
    })
    .catch((error: unknown) => {
      logger.warn('Audit log entry could not be written', {
        event: 'audit_log.write_failed',
        model: entry.model,
        operation: entry.operation,
        documentId: entry.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      pendingWrites.delete(write);
    });
  pendingWrites.add(write);
};

const isDocument = (value: unknown): value is Document => value instanceof Document;

// A findOneAnd* query hands its post hook the document, null when nothing matched, a plain object
// when lean, or a result wrapper with includeResultMetadata. Only results with an _id are recorded.
const idOf = (result: unknown): string | undefined => {
  const id = (result as { _id?: unknown } | null)?._id;
  if (id instanceof Types.ObjectId) return id.toHexString();
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
};

/**
 * Records who created, changed or removed a document, in the `audit_logs` collection.
 *
 * - `save()` is recorded as `create` for a new document, with the whole document, and as `update`
 *   otherwise, with only the paths it changed. A save that changed nothing is not recorded.
 * - `findOneAndUpdate()` is recorded with its update document, and `findOneAndDelete()` with the
 *   removed document. Neither reads the database again for a previous state: that state follows
 *   from the document's earlier entries.
 * - The actor comes from the request context: the signed-in user, 'anonymous' within a request
 *   without one, or 'system' outside requests (jobs, scripts).
 * - Sensitive fields are masked at any depth.
 *
 * Not recorded: `updateOne`, `updateMany`, `replaceOne`, `findOneAndReplace`, `insertMany`,
 * `bulkWrite`, `deleteOne` and `deleteMany`. Changes that must be audited go through the recorded
 * operations.
 */
export const auditLogPlugin = (schema: Schema): void => {
  // Whether a document is new, and which paths it changed, is only known before it is saved
  schema.pre('save', function (this: Document) {
    const pending: PendingSave = {
      wasNew: this.isNew,
      changes: this.isNew ? null : changedPaths(this),
    };
    this.$locals[PENDING_SAVE] = pending;
  });

  schema.post('save', function (doc: Document) {
    const pending = doc.$locals[PENDING_SAVE] as PendingSave | undefined;
    doc.$locals[PENDING_SAVE] = undefined;
    const documentId = idOf(doc);
    if (!pending || !documentId) return;

    const base = { model: doc.$model().modelName, documentId };
    if (pending.wasNew) {
      record({ ...base, operation: 'create', changes: snapshot(doc) });
    } else if (pending.changes) {
      record({ ...base, operation: 'update', changes: pending.changes });
    }
  });

  schema.post('findOneAndUpdate', function (this: Query<unknown, unknown>, result: unknown) {
    const documentId = idOf(result);
    if (!documentId) return;

    record({
      operation: 'update',
      model: this.model.modelName,
      documentId,
      changes: this.getUpdate(),
    });
  });

  // Models with soft delete block this operation; it is recorded for the ones without
  schema.post('findOneAndDelete', function (this: Query<unknown, unknown>, result: unknown) {
    const documentId = idOf(result);
    if (!documentId) return;

    record({
      operation: 'delete',
      model: this.model.modelName,
      documentId,
      changes: isDocument(result) ? snapshot(result) : result,
    });
  });
};

/** Resolves once every audit write started so far has finished, including those started meanwhile. */
export const flushAuditLogs = async (): Promise<void> => {
  while (pendingWrites.size > 0) {
    await Promise.all(pendingWrites);
  }
};
