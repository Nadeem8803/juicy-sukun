import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Integration tests need the Firebase emulators running: see `npm run test:integration` in the repo root. */
export default defineConfig({
  resolve: {
    alias: { '@juicy/shared': fileURLToPath(new URL('../projects/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
