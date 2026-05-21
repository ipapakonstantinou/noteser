import { test, expect } from '@playwright/test'

// Scenario: preview-mode-setting-in-ui
//
// Settings → Editor contains an "Open notes in preview mode" checkbox.
// The checkbox reflects the store value, and toggling it updates the store.
//
// Target: https://noteser.thetechjon.com (deployed app, absolute URLs)

const APP_URL = 'https://noteser.thetechjon.com'

async function waitForHooks(page: import('@playwright/test').Page, timeout = 15_000) {
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout },
  )
}

function addCleanSlateScript(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

test.describe('preview-mode-setting-in-ui', () => {
  test('Editor panel checkbox is visible and checked by default', async ({ page }) => {
    await addCleanSlateScript(page)
    await page.goto(APP_URL)
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
    await waitForHooks(page)

    // Open settings via store API (safe — avoids cog button issues).
    await page.evaluate(() => {
      window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
    })

    // Wait for the settings modal categories nav to appear.
    await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })

    // Navigate to the Editor category.
    await page.getByTestId('settings-cat-editor').click()

    // The editor panel should be visible.
    await expect(page.getByTestId('settings-panel-editor')).toBeVisible()

    // "Open notes in preview mode" label must be present.
    await expect(
      page.getByTestId('settings-panel-editor').getByText('Open notes in preview mode'),
    ).toBeVisible()

    // The checkbox in the editor panel must be checked (default = true).
    const checkbox = page
      .getByTestId('settings-panel-editor')
      .locator('input[type="checkbox"]')
      .first()
    await expect(checkbox).toBeChecked()
  })

  test('toggling the checkbox updates the store', async ({ page }) => {
    await addCleanSlateScript(page)
    await page.goto(APP_URL)
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
    await waitForHooks(page)

    // Confirm store default is true.
    const before = await page.evaluate(() =>
      window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode,
    )
    expect(before).toBe(true)

    // Open settings.
    await page.evaluate(() => {
      window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
    })
    await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('settings-cat-editor').click()
    await expect(page.getByTestId('settings-panel-editor')).toBeVisible()

    // Click the checkbox to toggle it off.
    const checkbox = page
      .getByTestId('settings-panel-editor')
      .locator('input[type="checkbox"]')
      .first()
    await checkbox.click()
    await page.waitForTimeout(100)

    // Store should now reflect false.
    const after = await page.evaluate(() =>
      window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode,
    )
    expect(after).toBe(false)

    // Checkbox should now be unchecked.
    await expect(checkbox).not.toBeChecked()
  })
})
