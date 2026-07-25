/**
 * Playwright config for the CI gate. Same as the local config, but scopes the
 * run to the STABLE top-level specs under e2e/ and excludes the experimental
 * e2e/parity/ specs.
 *
 * CLAUDE.md treats e2e/parity/ as a staging ground the qa-tester subagent
 * writes into; graduating a parity spec into the gated suite is a manual
 * decision. Keeping the CI gate to the top-level specs keeps it fast and
 * trustworthy (a red CI should mean a real regression, not a flaky draft spec).
 *
 * Run with:
 *   npm run e2e:ci
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // `_*.spec.ts` are utility scripts; `parity/**` are not-yet-graduated specs.
  testIgnore: ['**/_*.spec.ts', '**/parity/**'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  // The boot assert every spec opens with (`folder-tree` visible) waits on a
  // Next *dev* server on a 2-core runner. The 5s Playwright default flaked
  // twice on 2026-07-25 (runs 30157702324, 30158105758) with the page simply
  // not painted yet. 15s covers a loaded runner without hiding a real hang —
  // the per-test timeout stays 30s.
  expect: { timeout: 15_000 },
  // `github` alone writes no report, so the workflow's playwright-report
  // upload was always empty and every CI flake lost its trace/screenshot.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:3001',
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
