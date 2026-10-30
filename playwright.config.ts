import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'pixup-e2e-'));
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {},
  },
  webServer: [
    {
      command: 'node --import tsx apps/api/src/main.ts',
      url: 'http://127.0.0.1:4100/v1/health',
      reuseExistingServer: false,
      env: {
        PORT: '4100',
        DATA_DIR: dataDir,
        APP_MODE: 'demo',
        PAYMENT_PROVIDER: 'demo',
        APP_ORIGIN: 'http://127.0.0.1:3100',
      },
      timeout: 30000,
    },
    {
      command: 'node node_modules/next/dist/bin/next dev apps/web --port 3100 --hostname 127.0.0.1',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4100', NEXT_DIST_DIR: '.next-e2e' },
      timeout: 60000,
    },
  ],
});
