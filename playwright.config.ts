import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

try {
  loadEnvFile('.env');
} catch {
  // В CI переменные приходят из окружения.
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    {
      name: 'phone-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  globalSetup: './tests/helpers/playwright-global-setup.ts',
  webServer: {
    command: 'npm run build && npm run start -- --port 3100',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    // Сервер под тестами работает с отдельной базой: демо-данные не затираются.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? '' },
  },
});
