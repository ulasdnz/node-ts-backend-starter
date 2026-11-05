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
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        'src/test/**',
        'src/**/*.d.ts',
        // Operational entry points, exercised by running them rather than by unit tests
        'src/app.ts',
        'src/database/migrations/**',
        'src/database/seeders/**',
        'src/scripts/**',
      ],
      // A floor just under the current numbers: coverage can only ratchet up from here
      thresholds: {
        lines: 65,
        statements: 66,
        functions: 67,
        branches: 60,
      },
    },
    env: {
      NODE_ENV: 'test',
      // Placeholders that satisfy config validation. Tests reach MongoDB through setupTestDatabase,
      // and nothing listens on the Redis port, so no test can touch a developer's local Redis.
      MONGO_URI: 'mongodb://127.0.0.1:27017/unused',
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-chars',
    },
  },
});
