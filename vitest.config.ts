import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['apps/api/test/**/*.test.ts', 'packages/contracts/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
  environment: 'node', testTimeout: 10_000,
} });
