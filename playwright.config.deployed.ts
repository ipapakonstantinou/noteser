/**
 * Playwright config for running against the deployed production app at
 * https://noteser.thetechjon.com. Drops the `webServer` block so no dev
 * server is spawned — tests use absolute URLs instead of `baseURL`.
 *
 * Run with:
 *   npx playwright test --config playwright.config.deployed.ts e2e/parity/welcome-*.spec.ts
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/_*.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Give generous timeout — deployed app may cold-start on first hit.
  timeout: 45_000,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    // No baseURL — specs use absolute https:// URLs.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer block — tests go straight to the deployed URL.
})
