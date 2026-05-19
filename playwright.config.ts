import { defineConfig, devices } from '@playwright/test'

// E2E tests for noteser. Boots the dev server on http://localhost:3001
// automatically and points the browser at it. Run `npm run e2e` (headless)
// or `npm run e2e:headed` for the UI run.
//
// Tests live under `./e2e/`. Each test imports fixtures from
// `e2e/fixtures.ts` if it needs custom helpers — keep this config thin so
// the test layout stays obvious.

export default defineConfig({
  testDir: './e2e',
  // Single worker by default — the dev server is shared and Zustand
  // localStorage isolation is per-context. Parallelism can come later when
  // we have lots of tests; right now it just makes debugging harder.
  workers: 1,
  fullyParallel: false,
  // Surface failures fast on CI; locally we want to see the whole suite.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 30s per test is generous for a single-page app of this size.
  timeout: 30_000,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3001',
    // Capture rich evidence for failures — videos + traces + screenshots.
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

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    // Don't re-spawn if a dev server is already running locally — speeds
    // up the inner loop when you're iterating on a test.
    reuseExistingServer: !process.env.CI,
    // Cold compile of the app takes ~13s the first time after `.next` is
    // wiped, so give it a generous startup window.
    timeout: 120_000,
  },
})
