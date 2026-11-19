import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests (Pixel 7 viewport).
 *  - `customer-demo` and `admin-demo` use the in-memory demo backend (`?demo`): they need nothing but the dev servers.
 *  - `full-stack` needs the Firebase emulators as well: `npm run e2e:full`.
 */
const full = !!process.env['E2E_FULL'];
const launchOptions = process.env['PW_CHROMIUM'] ? { executablePath: process.env['PW_CHROMIUM'] } : {};
const mobile = devices['Pixel 7'];

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', launchOptions },
  projects: full
    ? [{ name: 'full-stack', testMatch: /full-stack\.spec\.ts/, use: { ...mobile, baseURL: 'http://localhost:4200' } }]
    : [
        { name: 'customer-demo', testMatch: /customer-demo\.spec\.ts/, use: { ...mobile, baseURL: 'http://localhost:4200' } },
        { name: 'admin-demo', testMatch: /admin-demo\.spec\.ts/, use: { ...mobile, baseURL: 'http://localhost:4201' } },
      ],
  webServer: [
    { command: 'npx ng serve customer --port 4200', url: 'http://localhost:4200', reuseExistingServer: !process.env['CI'], timeout: 120_000 },
    { command: 'npx ng serve admin --port 4201', url: 'http://localhost:4201', reuseExistingServer: !process.env['CI'], timeout: 120_000 },
  ],
});
