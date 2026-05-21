/**
 * welcome-dismiss-marks-onboarding
 *
 * Closing the Welcome tab flips `settingsStore.onboardingShown` to true
 * and reloading does NOT reopen the welcome tab.
 *
 * Runs against the deployed app at https://noteser.thetechjon.com.
 */

import { test, expect } from '@playwright/test'

const DEPLOYED = 'https://noteser.thetechjon.com'

function freshVault(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // onboardingShown = false so welcome tab auto-opens on first load.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

test('closing the welcome tab flips onboardingShown to true', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  // Welcome tab should auto-open.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  // Close the welcome tab. Find the close button (×) on the Welcome tab.
  // The tab bar should have a button to close the active tab. We look for
  // a button within the tab bar area near the "Welcome" label.
  // Try multiple strategies: tab close button, keyboard Ctrl+W, or direct store call.

  // Strategy 1: Find a close button (×) button near the Welcome tab label.
  // TabBar renders close buttons — they often have aria-label="Close" or similar.
  const closeBtn = page.locator('[data-testid^="tab-close"], button[aria-label*="lose"]').first()
  const hasCloseBtn = await closeBtn.isVisible().catch(() => false)

  if (hasCloseBtn) {
    await closeBtn.click()
  } else {
    // Strategy 2: Keyboard shortcut Ctrl+W closes the active tab.
    await page.keyboard.press('Control+w')
  }

  // Welcome pane should disappear.
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 5_000 })

  // Now verify onboardingShown flipped to true via the persisted localStorage.
  const onboardingShown = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('noteser-settings')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed?.state?.onboardingShown ?? null
    } catch {
      return null
    }
  })
  expect(onboardingShown).toBe(true)
})

test('after closing welcome tab, reloading does NOT reopen it', async ({ page }) => {
  // Unlike the other tests, this one MUST NOT use addInitScript because
  // addInitScript runs on every navigation (including reload), which would
  // reset onboardingShown back to false on reload and re-trigger the welcome tab.
  // Instead: navigate without any initScript, start from a clean URL with no
  // stored state, close the tab, then reload with the persisted state intact.

  // Clear state via a separate goto to the app first with initScript, then
  // rely on the app storing the dismissed state before we reload.
  //
  // Strategy: use addInitScript but make it conditional — only wipe state
  // on the FIRST load (identified by a sessionStorage marker set before reload).
  await page.addInitScript(() => {
    // Skip wiping if we've already been through our test scenario
    // (marked by a sessionStorage key we set before reloading).
    const skipWipe = sessionStorage.getItem('__test_skip_wipe')
    if (skipWipe === '1') return

    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })

  await page.goto(DEPLOYED)

  // Welcome tab appears.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  // Close the welcome tab. Try the close button first (the × next to "Welcome" label).
  const closeBtn = page.locator('button[aria-label="Close modal"], button[aria-label*="lose"]').first()
  const hasCloseBtn = await closeBtn.isVisible().catch(() => false)

  if (hasCloseBtn) {
    await closeBtn.click()
  } else {
    await page.keyboard.press('Control+w')
  }

  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 5_000 })

  // Wait for the Zustand persist middleware to flush to localStorage.
  await page.waitForFunction(() => {
    try {
      const raw = window.localStorage.getItem('noteser-settings')
      if (!raw) return false
      const parsed = JSON.parse(raw)
      return parsed?.state?.onboardingShown === true
    } catch {
      return false
    }
  }, undefined, { timeout: 5_000 })

  // Mark sessionStorage so the initScript skips wiping on reload.
  await page.evaluate(() => sessionStorage.setItem('__test_skip_wipe', '1'))

  // Reload the page. The onboardingShown flag is now in localStorage;
  // the initScript will skip the wipe (due to the sessionStorage marker).
  await page.reload()

  // Give the app time to hydrate.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(2_000)

  // The welcome pane should NOT reappear — onboardingShown is true in localStorage.
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible()
})

test('welcome tab does not open when onboardingShown is already true', async ({ page }) => {
  // This test directly verifies the guard condition.
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-seed with onboardingShown = true.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* ignore */ }
  })

  await page.goto(DEPLOYED)

  // Give the app time to hydrate and run its onboarding effect.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(2_000)

  // Welcome pane should NOT be visible — onboardingShown was already true.
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible()
})
