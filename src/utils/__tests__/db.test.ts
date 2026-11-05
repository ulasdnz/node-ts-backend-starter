import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDB, disconnectDB } from '../db.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connectDB', () => {
  it('passes a connection failure to the caller instead of exiting', async () => {
    vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('unreachable'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await expect(connectDB()).rejects.toThrow('unreachable');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('disconnectDB', () => {
  it('passes a failed close to the caller', async () => {
    vi.spyOn(mongoose.connection, 'close').mockRejectedValueOnce(new Error('close failed'));

    await expect(disconnectDB()).rejects.toThrow('close failed');
  });
});
