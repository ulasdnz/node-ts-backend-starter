import { type Connection, mongo } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from 'winston';

export interface MigrationContext {
  db: mongo.Db;
  logger: Logger;
}

export interface Migration {
  up(context: MigrationContext): Promise<void>;
}

export interface RunMigrationsOptions {
  connection: Connection;
  logger: Logger;
  /** The directory holding the migration files, and nothing else is loaded from it. */
  directory: string;
  /** '.ts' when run from source, '.js' when run from the build. */
  extension: '.ts' | '.js';
  /** Identifies this run in the lock document; random by default. */
  owner?: string;
}

export class MigrationLockedError extends Error {
  constructor() {
    super('Another migration run holds the lock. Retry once it has finished.');
    this.name = 'MigrationLockedError';
  }
}

interface AppliedMigration {
  name: string;
  appliedAt: Date;
}

interface MigrationLock {
  _id: string;
  lockedAt: Date;
  owner: string;
}

const LOCK_ID = 'lock';
// A run that crashed cannot release its lock; after this long the lock is presumed abandoned
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
const RUNNER_FILES = new Set(['index', 'runner']);

/** Migration names in the directory, in the order they run: file names without the extension. */
export const listMigrations = async (
  directory: string,
  extension: RunMigrationsOptions['extension'],
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .filter((entry) => !entry.name.endsWith('.d.ts'))
    .map((entry) => entry.name.slice(0, -extension.length))
    .filter((name) => !RUNNER_FILES.has(name))
    .sort();
};

const isMigration = (value: unknown): value is Migration =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<Migration>).up === 'function';

const loadMigration = async (file: string): Promise<Migration> => {
  const module: unknown = await import(pathToFileURL(file).href);
  if (!isMigration(module)) {
    throw new Error(`Migration ${path.basename(file)} does not export an up() function`);
  }
  return module;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/**
 * Takes the lock unless a run holds a fresh one. The upsert matches only a stale lock or none, so
 * against a fresh lock it tries to insert a second document with the same _id, and the unique _id
 * index turns that into a duplicate key error: the database decides, not a read followed by a write.
 */
const acquireLock = async (
  locks: mongo.Collection<MigrationLock>,
  owner: string,
): Promise<void> => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_STALE_AFTER_MS);

  try {
    await locks.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ lockedAt: { $lt: staleBefore } }, { lockedAt: { $exists: false } }] },
      { $set: { lockedAt: now, owner } },
      { upsert: true },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new MigrationLockedError();
    throw error;
  }
};

// Each migration renews the lock, so only a single migration running longer than the stale limit
// could lose it. Losing it means another run may have started: stop rather than run side by side.
const renewLock = async (locks: mongo.Collection<MigrationLock>, owner: string): Promise<void> => {
  const { matchedCount } = await locks.updateOne(
    { _id: LOCK_ID, owner },
    { $set: { lockedAt: new Date() } },
  );
  if (matchedCount === 0) throw new MigrationLockedError();
};

/**
 * Applies the migrations in `directory` that this database has not applied yet, in name order, and
 * records each one in the `migrations` collection. One run at a time: a lock document in
 * `migrations_lock` keeps concurrent deploys from applying the same migration twice.
 *
 * Migrations are forward-only and should be safe to run again: one that fails halfway is not
 * recorded, so the next run starts it over. Returns the names it applied.
 */
export const runMigrations = async ({
  connection,
  logger,
  directory,
  extension,
  owner = randomUUID(),
}: RunMigrationsOptions): Promise<string[]> => {
  const { db } = connection;
  if (!db) throw new Error('runMigrations needs an open connection');

  const applied = db.collection<AppliedMigration>('migrations');
  const locks = db.collection<MigrationLock>('migrations_lock');

  await acquireLock(locks, owner);
  try {
    await applied.createIndex({ name: 1 }, { unique: true });
    const done = new Set(
      (await applied.find({}, { projection: { name: 1 } }).toArray()).map(({ name }) => name),
    );
    const pending = (await listMigrations(directory, extension)).filter((name) => !done.has(name));

    for (const name of pending) {
      await renewLock(locks, owner);
      const migration = await loadMigration(path.join(directory, `${name}${extension}`));

      logger.info('Applying migration', { event: 'migration.started', migration: name });
      await migration.up({ db, logger });
      await applied.insertOne({ name, appliedAt: new Date() });
      logger.info('Migration applied', { event: 'migration.applied', migration: name });
    }

    return pending;
  } finally {
    await locks.deleteOne({ _id: LOCK_ID, owner });
  }
};
