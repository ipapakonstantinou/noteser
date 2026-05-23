import { defineConfig, devices } from '@playwright/test'

// Playwright config dedicated to `scripts/refresh-tour-screenshots.ts`.
//
// Reasons this lives separately from the project-level `playwright.config.ts`:
//   - The refresh script lives in `scripts/`, outside `e2e/`.
//   - The dev server runs on port 3010 instead of 3001 so the script can
//     run alongside another `npm run dev` already serving on 3001
//     (which may be on a different branch).
//
// Run from the worktree root:
//   npx playwright test --config=scripts/refresh-tour-screenshots.config.ts

export default defineConfig({
  testDir: '.',
  testMatch: /refresh-tour-screenshots\.ts$/,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'PORT=3010 next dev --turbopack -H 127.0.0.1 -p 3010',
    url: 'http://localhost:3010',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
