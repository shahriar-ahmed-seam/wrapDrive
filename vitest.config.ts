import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/android/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/**/src/**'],
    },
  },
});
