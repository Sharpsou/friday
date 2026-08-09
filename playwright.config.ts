import { defineConfig, devices } from '@playwright/test';

const port = process.env.FRIDAY_E2E_PORT ?? '8443';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'google-chrome-mobile',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 412, height: 915 },
      },
    },
  ],
  webServer: {
    command: 'pnpm preview',
    env: {
      ...process.env,
      FRIDAY_DATABASE_PATH: ':memory:',
      FRIDAY_AUTH_ATTEMPT_LIMIT: '1000',
      FRIDAY_HOST: '127.0.0.1',
      FRIDAY_PORT: port,
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: `http://127.0.0.1:${port}/api/health`,
  },
});
