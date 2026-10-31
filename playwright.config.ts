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
      command: 'node --import tsx tests/fixtures/community-browser-server.ts',
      url: 'http://127.0.0.1:4100/v1/health',
      reuseExistingServer: false,
      env: {
        PORT: '4100',
        COMMUNITY_ENABLED: 'true',
        COMMUNITY_WRITES_ENABLED: 'true',
        DATA_DIR: dataDir,
        APP_MODE: 'demo',
        IDENTITY_ENCRYPTION_KEY: 'ab'.repeat(32),
        IDENTITY_MAIL_PROVIDER: 'disabled',
        STAFF_MFA_REQUIRED: 'false',
        VERIFIED_INVITATIONS_REQUIRED: 'false',
        OIDC_ISSUER: '',
        DATABASE_HARDENED: 'false',
        DATABASE_URL: '',
        DATABASE_WORKER_URL: '',
        DATABASE_MIGRATION_URL: '',
        SEED_DEMO: 'true',
        PAYMENT_PROVIDER: 'demo',
        BILLING_PROVIDER: 'disabled',
        CONNECT_TEST_COUNTRIES: '',
        CONNECT_TEST_TRANSFERS: 'false',
        EVIDENCE_STORAGE: 'database',
        MANAGED_ARTWORK: 'false',
        CLAMAV_SOCKET: '',
        PHYSICAL_CAPTURE_REQUIRED: 'false',
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
