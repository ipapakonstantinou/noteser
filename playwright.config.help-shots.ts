// One-off Playwright config for running e2e/_help-screenshots.spec.ts.
// The main playwright.config.ts ignores `_*.spec.ts` so the marketing /
// screenshot scripts don't pollute the regular suite. This config
// inverts the rule: it ONLY runs files matching `_help-screenshots`.
//
// Run:
//   npx playwright test -c playwright.config.help-shots.ts
//
// Not imported by anything; safe to delete after the screenshots are
// regenerated, or keep around for the next refresh.

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/_help-screenshots.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
