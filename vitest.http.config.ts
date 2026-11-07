import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/http/**/*.test.ts'],
    globalSetup: ['tests/http/global-setup.ts'],
    testTimeout: 30_000,
  },
});
