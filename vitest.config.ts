import { defineConfig } from 'vitest/config';

// Unit + integration tests (no emulator needed). Rules tests: vitest.rules.config.ts.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/worker/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
