import mongoose, { Schema } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInContext } from '../../../core/middleware/request-context.js';
import { logger } from '../../../lib/logger.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { AuditLog } from '../audit-log.model.js';
import { auditLogPlugin, flushAuditLogs } from '../audit-log.plugin.js';

interface AuditedDoc {
  name: string;
  value: number;
  password?: string;
  credentials?: { token?: string };
}

// No soft delete on this model, so findOneAndDelete reaches the audit hook
const auditedSchema = new Schema<AuditedDoc>({
  name: { type: String, required: true },
  value: { type: Number, default: 0 },
  password: String,
  credentials: { token: String },
});
auditedSchema.plugin(auditLogPlugin);
const Audited = mongoose.model<AuditedDoc>('AuditedThing', auditedSchema);

setupTestDatabase();

const entriesFor = async (documentId: string) => {
  await flushAuditLogs();
  return AuditLog.find({ documentId }).sort({ timestamp: 1, _id: 1 }).lean();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auditLogPlugin', () => {
  it('records creation with sensitive fields masked', async () => {
    const doc = await Audited.create({
      name: 'created',
      password: 'plain-secret',
      credentials: { token: 'abc' },
    });

    const [entry] = await entriesFor(doc.id);

    expect(entry).toMatchObject({
      operation: 'create',
      model: 'AuditedThing',
      documentId: doc.id,
      changes: { name: 'created', password: '[REDACTED]', credentials: { token: '[REDACTED]' } },
    });
  });

  it('records an update through save() as an update with only the changed fields', async () => {
    const doc = await Audited.create({ name: 'saved', value: 1 });
    doc.value = 2;
    doc.set('credentials.token', 'rotated');
    await doc.save();

    const entries = await entriesFor(doc.id);

    expect(entries.map((entry) => entry.operation)).toEqual(['create', 'update']);
    expect(entries[1].changes).toEqual({ value: 2, 'credentials.token': '[REDACTED]' });
  });

  it('skips a save() that changed nothing', async () => {
    const doc = await Audited.create({ name: 'unchanged' });
    await doc.save();

    const entries = await entriesFor(doc.id);

    expect(entries.map((entry) => entry.operation)).toEqual(['create']);
  });

  it('records findOneAndUpdate with the update document', async () => {
    const doc = await Audited.create({ name: 'queried' });

    await Audited.findOneAndUpdate(
      { _id: doc._id },
      { $set: { value: 3, password: 'new-secret' } },
    );

    const entries = await entriesFor(doc.id);

    expect(entries[1]).toMatchObject({
      operation: 'update',
      changes: { $set: { value: 3, password: '[REDACTED]' } },
    });
  });

  it('records findOneAndDelete with the removed document', async () => {
    const doc = await Audited.create({ name: 'removed', password: 'plain-secret' });

    await Audited.findOneAndDelete({ _id: doc._id });

    const entries = await entriesFor(doc.id);

    expect(entries[1]).toMatchObject({
      operation: 'delete',
      changes: { name: 'removed', password: '[REDACTED]' },
    });
  });

  it('takes the actor from the request context', async () => {
    const doc = await runInContext({ traceId: 't-1', ip: '::1', userId: 'u-1' }, () =>
      Audited.create({ name: 'by-user' }),
    );

    const [entry] = await entriesFor(doc.id);

    expect(entry.actor).toEqual({ userId: 'u-1', traceId: 't-1', ip: '::1' });
  });

  it('records anonymous as the actor of a request without a signed-in user', async () => {
    const doc = await runInContext({ traceId: 't-2', ip: '::1' }, () =>
      Audited.create({ name: 'by-visitor' }),
    );

    const [entry] = await entriesFor(doc.id);

    expect(entry.actor).toEqual({ userId: 'anonymous', traceId: 't-2', ip: '::1' });
  });

  it('records system as the actor outside a request', async () => {
    const doc = await Audited.create({ name: 'by-system' });

    const [entry] = await entriesFor(doc.id);

    expect(entry.actor).toEqual({ userId: 'system', traceId: null, ip: null });
  });

  it('never fails the write it audits', async () => {
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit store down'));
    const warn = vi.spyOn(logger, 'warn');

    const doc = await Audited.create({ name: 'unaudited' });
    await flushAuditLogs();

    expect(await Audited.exists({ _id: doc._id })).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'audit_log.write_failed', operation: 'create' }),
    );
  });

  it('flushAuditLogs waits for pending writes', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(AuditLog, 'create').mockImplementationOnce(async () => {
      await held;
      return [];
    });
    await Audited.create({ name: 'pending' });

    let flushed = false;
    const flushing = flushAuditLogs().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flushed).toBe(false);

    release();
    await flushing;
    expect(flushed).toBe(true);
  });
});
