import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';
import './provided-context.js';

let server: MongoMemoryServer | undefined;

// A cold mongod start on a busy machine (a virus scan on Windows, a shared CI runner) can take longer
// than the library's 10 s default, which fails the whole run before any test starts
const MONGOD_LAUNCH_TIMEOUT_MS = 60_000;

// One in-memory MongoDB serves the whole run. Each test file connects to a database of its own on
// it (see setupTestDatabase), so files still run in parallel without sharing data, and the run pays
// for a single mongod start instead of one per file.
export async function setup(project: TestProject): Promise<void> {
  server = await MongoMemoryServer.create({
    instance: { launchTimeout: MONGOD_LAUNCH_TIMEOUT_MS },
  });
  project.provide('mongoUri', server.getUri());
}

export async function teardown(): Promise<void> {
  await server?.stop();
}
