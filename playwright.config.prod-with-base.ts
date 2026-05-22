/**
 * Temporary config for running specs that use relative page.goto('/') against prod.
 * Used only during QA sweeps — do not commit to main suite.
 */
import { defineConfig, devices } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://noteser.thetechjon.com'

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/_*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
