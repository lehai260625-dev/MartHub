import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:13000', trace: 'retain-on-failure' },
  projects: [360, 768, 1024, 1440].map((width) => ({
    name: 'chromium-' + width,
    use: { browserName: 'chromium', viewport: { width, height: 900 } },
  })),
  webServer: [
    {
      command:
        'node scripts/prepare-e2e-database.js && npm start --workspace @marthub/api',
      url: 'http://127.0.0.1:4000/api/v1/health/ready',
      env: {
        NODE_ENV: 'test',
        AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
        PORT: '4000',
        HOST: '127.0.0.1',
        WEB_ORIGIN: 'http://127.0.0.1:13000',
        CLOUDINARY_CLOUD_NAME: 'marthub-test',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'test-secret-long-enough',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'npm start --workspace @marthub/web -- --hostname 127.0.0.1 --port 13000',
      url: 'http://127.0.0.1:13000',
      env: {
        WEB_ORIGIN: 'https://127.0.0.1:13000',
        API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
