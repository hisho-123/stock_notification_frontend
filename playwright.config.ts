import { defineConfig } from '@playwright/test';
const port = process.env.E2E_PORT || '5173';
const apiPort = process.env.E2E_API_PORT || '18080';
const origin = `https://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: origin, ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'node tests/stub-api.mjs',
      url: `http://127.0.0.1:${apiPort}/__test/health`,
      env: { TEST_ORIGIN: origin, E2E_API_PORT: apiPort },
      reuseExistingServer: false,
    },
    {
      command:
        process.env.E2E_COVERAGE === '1'
          ? 'npm run preview -- --outDir .coverage-dist'
          : 'npm run preview',
      url: origin,
      ignoreHTTPSErrors: true,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, E2E_PORT: port },
      reuseExistingServer: false,
    },
  ],
});
