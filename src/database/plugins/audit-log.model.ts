import mongoose, { type InferSchemaType, Schema } from 'mongoose';

export const AUDIT_OPERATIONS = ['create', 'update', 'delete'] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

const auditLogSchema = new Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    operation: { type: String, required: true, enum: AUDIT_OPERATIONS },
    model: { type: String, required: true },
    documentId: { type: String, required: true },
    actor: {
      // A user id, 'anonymous' for a request without a signed-in user, or 'system' outside requests
      userId: { type: String, required: true },
      traceId: { type: String, default: null },
      ip: { type: String, default: null },
    },
    // Created or removed: the document. Saved: the changed paths. findOneAndUpdate: the update.
    changes: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'audit_logs',
    versionKey: false,
  },
);

// What happened to this document?
auditLogSchema.index({ model: 1, documentId: 1, timestamp: -1 });
// What did this user do?
auditLogSchema.index({ 'actor.userId': 1, timestamp: -1 });

export type AuditLogEntry = InferSchemaType<typeof auditLogSchema>;

/** Append-only: the application writes entries and never changes them. */
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
