import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/global-setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    env: {
      NODE_ENV: 'test',
      // Placeholders that satisfy config validation; tests reach MongoDB through setupTestDatabase
      // and never open a Redis connection.
      MONGO_URI: 'mongodb://127.0.0.1:27017/unused',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-chars',
    },
  },
});
