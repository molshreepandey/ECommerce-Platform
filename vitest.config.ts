import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/http/**', 'tests/integration/**', 'node_modules/**'],
    setupFiles: ['tests/setup-env.ts'],
  },
});
