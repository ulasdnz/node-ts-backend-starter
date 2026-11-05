import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { objectIdSchema } from '../validators.js';

describe('objectIdSchema', () => {
  it('accepts a 24-character hex id', () => {
    const id = new Types.ObjectId().toHexString();

    expect(objectIdSchema.parse(id)).toBe(id);
  });

  it('rejects a 12-character string, which older bson versions took for raw bytes', () => {
    const result = objectIdSchema.safeParse('twelve-chars');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('error.invalid_id');
  });

  it('rejects hex of the wrong length', () => {
    expect(objectIdSchema.safeParse('abc123').success).toBe(false);
  });
});
