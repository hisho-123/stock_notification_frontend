import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'https://localhost:5173', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
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
      url: 'http://127.0.0.1:18080/__test/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview',
      url: 'https://localhost:5173',
      ignoreHTTPSErrors: true,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:18080' },
      reuseExistingServer: false,
    },
  ],
});
