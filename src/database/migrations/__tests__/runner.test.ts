import mongoose from 'mongoose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../../lib/logger.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { listMigrations, MigrationLockedError, runMigrations } from '../runner.js';

setupTestDatabase();

let directory: string;

const db = () => mongoose.connection.db!;
const locks = () =>
  db().collection<{ _id: string; lockedAt: Date; owner: string }>('migrations_lock');
const lockDocument = () => locks().findOne({});
const holdLock = (owner: string, ageMs: number) =>
  locks().insertOne({ _id: 'lock', lockedAt: new Date(Date.now() - ageMs), owner });
const appliedNames = async () =>
  (await db().collection('migrations').find().sort({ name: 1 }).toArray()).map((doc) => doc.name);
const traced = async () =>
  (await db().collection('trace').find().sort({ _id: 1 }).toArray()).map((doc) => doc.name);

// Each migration records that it ran, so the tests can see what ran and in which order
const writeMigration = (fileName: string, body?: string) =>
  writeFile(
    path.join(directory, fileName),
    body ??
      `export async function up({ db }) {
        await db.collection('trace').insertOne({ name: ${JSON.stringify(fileName)} });
      }\n`,
  );

const run = (owner?: string) =>
  runMigrations({ connection: mongoose.connection, logger, directory, extension: '.js', owner });

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  // The migration files are ES modules, like the compiled ones
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  // These collections have no model, so the shared cleanup does not empty them
  await Promise.all(
    ['migrations', 'migrations_lock', 'trace'].map((name) => db().collection(name).deleteMany({})),
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('applies pending migrations in name order and records them', async () => {
    await writeMigration('20260102-second.js');
    await writeMigration('20260101-first.js');

    const applied = await run();

    expect(applied).toEqual(['20260101-first', '20260102-second']);
    expect(await traced()).toEqual(['20260101-first.js', '20260102-second.js']);
    expect(await appliedNames()).toEqual(['20260101-first', '20260102-second']);
  });

  it('skips migrations that were already applied', async () => {
    await writeMigration('20260101-first.js');
    await run();
    await writeMigration('20260102-second.js');

    const applied = await run();

    expect(applied).toEqual(['20260102-second']);
    expect(await traced()).toEqual(['20260101-first.js', '20260102-second.js']);
  });

  it("ignores the runner's own files and declaration files", async () => {
    const mustNotLoad = "throw new Error('not a migration');\n";
    await writeMigration('index.js', mustNotLoad);
    await writeMigration('runner.js', mustNotLoad);
    await writeMigration('20260101-first.js');

    expect(await run()).toEqual(['20260101-first']);

    for (const name of ['index.ts', 'runner.ts', 'x.d.ts', '20260101-first.ts', 'README.md']) {
      await writeFile(path.join(directory, name), '');
    }
    expect(await listMigrations(directory, '.ts')).toEqual(['20260101-first']);
  });

  it('refuses to run while another run holds the lock', async () => {
    await writeMigration('20260101-first.js');
    await holdLock('other-run', 0);

    await expect(run()).rejects.toBeInstanceOf(MigrationLockedError);

    expect(await traced()).toEqual([]);
    // Another run's lock is never released by this one
    expect(await lockDocument()).toMatchObject({ owner: 'other-run' });
  });

  it('takes over a lock older than ten minutes', async () => {
    await writeMigration('20260101-first.js');
    await holdLock('crashed-run', 11 * 60 * 1000);

    expect(await run()).toEqual(['20260101-first']);
    expect(await lockDocument()).toBeNull();
  });

  it('releases the lock when a migration fails', async () => {
    await writeMigration(
      '20260101-broken.js',
      "export async function up() { throw new Error('boom'); }\n",
    );

    await expect(run()).rejects.toThrow('boom');

    expect(await lockDocument()).toBeNull();
    expect(await appliedNames()).toEqual([]);
  });

  it('rejects a file that does not export up()', async () => {
    await writeMigration('20260101-empty.js', 'export const nothing = true;\n');

    await expect(run()).rejects.toThrow('20260101-empty');
    expect(await lockDocument()).toBeNull();
  });
});
