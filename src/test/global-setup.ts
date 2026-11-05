import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';
import './provided-context.js';

let server: MongoMemoryServer | undefined;

// One in-memory MongoDB serves the whole run. Each test file connects to a database of its own on
// it (see setupTestDatabase), so files still run in parallel without sharing data, and the run pays
// for a single mongod start instead of one per file.
export async function setup(project: TestProject): Promise<void> {
  server = await MongoMemoryServer.create();
  project.provide('mongoUri', server.getUri());
}

export async function teardown(): Promise<void> {
  await server?.stop();
}
