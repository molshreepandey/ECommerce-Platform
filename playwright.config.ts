import { defineConfig, devices } from '@playwright/test';

import { storeOrigin } from './tests/support/test-app';

const isContinuousIntegration = process.env['CI'] !== undefined;
const storefrontCatalogueSpec = /storefront-catalogue\.spec\.ts$/;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isContinuousIntegration,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: storefrontCatalogueSpec,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile-360',
      testIgnore: storefrontCatalogueSpec,
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
    // Wave 14: tablet width (plan §10D: 360 px, tablet and desktop).
    {
      name: 'chromium-tablet-768',
      testIgnore: storefrontCatalogueSpec,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    // Loads the demo catalogue into the test database, so it runs after every other spec.
    {
      name: 'storefront-catalogue',
      testMatch: storefrontCatalogueSpec,
      dependencies: ['chromium-desktop', 'chromium-mobile-360', 'chromium-tablet-768'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start:test',
    url: `${storeOrigin}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
