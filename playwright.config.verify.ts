import { defineConfig, devices } from '@playwright/test'

// Runner config for the `e2e/_verify_*.spec.ts` scripts — the by-hand
// verification specs that point at an ALREADY-RUNNING target (a local
// `next start`, a preview deploy, production) rather than at a dev server this
// config boots.
//
// It exists because the main config's `testIgnore: '**/_*.spec.ts'` also
// applies when you name such a file on the command line, so the only way to run
// one used to be renaming it off the underscore — a hand-edit before every run
// and an easy way to leak the rename into a commit.
//
//   npm run build && npx next start -p 3999          (separate shell)
//   CSP_BASE_URL=http://127.0.0.1:3999 npm run e2e:verify e2e/_verify_worker_csp.spec.ts
//
// No `webServer` on purpose: these specs verify a real server's headers and
// behaviour, and silently starting a dev server would verify the wrong build.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/_verify_*.spec.ts',
  workers: 1,
  fullyParallel: false,
  // These talk to a real server over the network and sometimes wait on a
  // worker boot; the 30s of the main config is tight for that.
  timeout: 60_000,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
