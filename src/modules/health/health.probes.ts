import type { Redis } from 'ioredis';
import mongoose, { type Connection } from 'mongoose';
import { withTimeout } from '../../utils/timeout.js';

/** A dependency check; throws when the dependency cannot serve requests. */
export interface HealthProbe {
  name: string;
  /**
   * Whether the API needs this dependency to serve requests (default true). Readiness fails only on
   * critical probes; /health reports every probe.
   */
  critical?: boolean;
  check(): Promise<void>;
}

// Probes run on every readiness check, so a hung dependency must fail fast, not hold the check open
const DEFAULT_TIMEOUT_MS = 1500;

export const mongoProbe = (
  connection: Connection = mongoose.connection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HealthProbe => ({
  name: 'mongodb',
  critical: true,
  check: async () => {
    if (connection.readyState !== mongoose.ConnectionStates.connected || !connection.db) {
      throw new Error('MongoDB is not connected');
    }
    await withTimeout(connection.db.admin().ping(), timeoutMs, 'MongoDB ping');
  },
});

export const redisProbe = (
  client: Pick<Redis, 'ping'>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HealthProbe => ({
  name: 'redis',
  // Caching and rate limiting degrade without Redis instead of failing, so a Redis outage must not
  // take every instance out of rotation at once
  critical: false,
  check: async () => {
    await withTimeout(client.ping(), timeoutMs, 'Redis ping');
  },
});
