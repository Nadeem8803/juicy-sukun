import { defineConfig } from 'vitest/config';

/** Unit tests for the shared domain package (pricing, order rules, validation, menu seed). */
export default defineConfig({
  test: {
    include: ['projects/shared/**/*.spec.ts'],
    environment: 'node',
  },
});
