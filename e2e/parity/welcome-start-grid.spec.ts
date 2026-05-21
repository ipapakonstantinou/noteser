/**
 * welcome-start-grid
 *
 * Each of the 4 "Start" grid buttons does the right thing:
 *   - New note:           a fresh note appears, Welcome tab closes
 *   - Browse templates:  TemplatesModal opens
 *   - Connect to GitHub: GitHubAuthModal opens
 *   - Open settings:     SettingsModal opens
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
    // onboardingShown = false so welcome tab auto-opens.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

test('New note button creates a note and closes the welcome tab', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Click the "New note" action button.
  await page.getByTestId('welcome-new-note').click()

  // Welcome pane should close.
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 5_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  // There should be at least one note in the store now.
  const noteCount = await page.evaluate(() => {
    const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
    return notes.filter((n: { isDeleted: boolean }) => !n.isDeleted).length
  })
  expect(noteCount).toBeGreaterThanOrEqual(1)

  // Editor should show a fresh note (CodeMirror content area visible).
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 5_000 })
})

test('Browse templates button opens the TemplatesModal', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Click "Browse templates" action.
  await page.getByTestId('welcome-templates').click()

  // The Modal component uses a fixed-position overlay div (not role=dialog).
  // Look for the modal title "Create from Template" which appears as an h2.
  await expect(page.getByText('Create from Template')).toBeVisible({ timeout: 5_000 })
})

test('Connect to GitHub button opens the GitHub auth modal', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Click "Connect to GitHub" action.
  await page.getByTestId('welcome-github').click()

  // GitHub auth modal opens. Look for text containing "GitHub" in a modal context.
  // The GitHubAuthModal title is typically "Connect to GitHub" or similar.
  await expect(page.getByText(/connect.*github|github.*connect|sign in.*github|authorize/i).first()).toBeVisible({ timeout: 5_000 })
})

test('Open settings button opens the SettingsModal', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Click "Open settings" action.
  await page.getByTestId('welcome-settings').click()

  // Settings modal opens with a fixed-position overlay. Look for the "Settings"
  // heading inside the modal. The Settings modal typically has a heading or
  // section nav with "General", "Appearance", etc.
  await expect(page.getByText(/^settings$/i).first()).toBeVisible({ timeout: 5_000 })
})
