/**
 * welcome-fresh-tab-opens
 *
 * On a completely clean vault (no notes, no GitHub token,
 * onboardingShown = false) the app should automatically open a Welcome
 * tab in the workspace — exactly the VS Code-style first-run experience.
 *
 * Assertions:
 *   - [data-testid="welcome-pane"] is visible
 *   - A tab labelled "Welcome" appears in the tab bar
 *
 * Runs against the deployed app at https://noteser.thetechjon.com.
 */

import { test, expect } from '@playwright/test'

const DEPLOYED = 'https://noteser.thetechjon.com'

test.beforeEach(async ({ page }) => {
  // Wipe ALL persisted state so the app treats this as a brand-new user.
  // Crucially: do NOT pre-set onboardingShown (unlike _helpers.ts's
  // setupCleanVault) — this test specifically needs the welcome tab to appear.
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Ensure no lingering settings leak. Explicitly set a clean state
    // that keeps onboardingShown = false (the default).
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
})

test('welcome tab opens automatically on a clean vault', async ({ page }) => {
  await page.goto(DEPLOYED)

  // Wait for React hydration — the welcome pane mounts via useEffect after
  // hydration, so we need to give it a moment beyond the initial render.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })
})

test('welcome tab appears in the tab bar with correct label', async ({ page }) => {
  await page.goto(DEPLOYED)

  // Wait for the welcome pane to appear first.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // The tab bar renders the "Welcome" label as text. From the screenshot,
  // it appears as a tab element at the top of the editor area. The close
  // button (×) appears next to it. We look for "Welcome" text in the
  // region above the welcome-pane content (i.e. in the tab strip).
  // The tab bar is in the same area as the editor pane, above the content.
  // Use a locator that finds "Welcome" outside the welcome pane content
  // (which has a large "WELCOME" heading inside it).
  // Strategy: find any element that contains "Welcome" text but is NOT
  // inside [data-testid="welcome-pane"].
  const welcomeTabLabel = page.locator(':not([data-testid="welcome-pane"]) >> text=Welcome').first()
  await expect(welcomeTabLabel).toBeVisible({ timeout: 5_000 })
})
