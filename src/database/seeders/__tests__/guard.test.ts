import { describe, expect, it } from 'vitest';
import { assertSeedingAllowed } from '../guard.js';

const target = (mongoUri: string, overrides: { nodeEnv?: string; allowRemote?: boolean } = {}) => ({
  nodeEnv: 'development',
  mongoUri,
  allowRemote: false,
  ...overrides,
});

describe('assertSeedingAllowed', () => {
  it('allows a database on this machine', () => {
    for (const uri of [
      'mongodb://localhost:27017/app',
      'mongodb://127.0.0.1/app',
      'mongodb://[::1]:27017/app',
      'mongodb://user:secret@localhost:27017,127.0.0.1:27018/app?replicaSet=rs0',
    ]) {
      expect(() => assertSeedingAllowed(target(uri))).not.toThrow();
    }
  });

  it('refuses production whatever the database', () => {
    expect(() =>
      assertSeedingAllowed(target('mongodb://localhost/app', { nodeEnv: 'production' })),
    ).toThrow('production');
  });

  // NODE_ENV defaults to development, so it cannot be the only guard against a production URI
  it('refuses a database elsewhere unless asked to with --allow-remote', () => {
    for (const uri of [
      'mongodb://db.example.com:27017/app',
      'mongodb://localhost:27017,db.example.com:27017/app',
      'mongodb+srv://user:secret@cluster0.example.net/app',
    ]) {
      expect(() => assertSeedingAllowed(target(uri))).toThrow('--allow-remote');
      expect(() => assertSeedingAllowed(target(uri, { allowRemote: true }))).not.toThrow();
    }
  });

  it('names the host but not the credentials in its refusal', () => {
    expect(() =>
      assertSeedingAllowed(target('mongodb://admin:hunter2@db.example.com/app')),
    ).toThrow(/^(?!.*hunter2).*db\.example\.com/);
  });
});
