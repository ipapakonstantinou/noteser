import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// settings-ui-preview-mode-toggle
//
// Settings → Editor → "Open notes in preview mode" checkbox:
//   - The checkbox is visible in the Editor panel.
//   - Toggling the checkbox updates settingsStore.notesOpenInPreviewMode.
//   - The store value persists (i.e. is correctly reflected back on a re-open).
//
// This is settings-side coverage for the preview-mode feature. The editor-side
// behavioral coverage lives in e2e/parity/single-click-preview-double-click-pin.spec.ts.
//
// Target: https://noteser.thetechjon.com (deployed build).

const BASE_URL = 'https://noteser.thetechjon.com'

async function openEditorPanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 10_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
  await page.getByTestId('settings-cat-editor').click()
  await expect(page.getByTestId('settings-panel-editor')).toBeVisible({ timeout: 3_000 })
}

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('Editor panel renders the preview mode checkbox', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await openEditorPanel(page)

  // The field label should be visible.
  await expect(
    page.getByTestId('settings-panel-editor').getByText('Open notes in preview mode')
  ).toBeVisible()

  // There should be a checkbox element in the panel.
  const checkbox = page.getByTestId('settings-panel-editor').locator('input[type="checkbox"]').first()
  await expect(checkbox).toBeVisible()
})

test('toggling preview mode checkbox updates settingsStore.notesOpenInPreviewMode', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await openEditorPanel(page)

  // Read the current value from the store.
  const initialValue = await page.evaluate(() => {
    return window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode
  })

  // Click the checkbox to toggle.
  const checkbox = page.getByTestId('settings-panel-editor').locator('input[type="checkbox"]').first()
  await checkbox.click()

  // The store value should have flipped.
  const newValue = await page.evaluate(() => {
    return window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode
  })
  expect(newValue).toBe(!initialValue)

  // Toggle back to confirm it's a real two-way toggle.
  await checkbox.click()
  const finalValue = await page.evaluate(() => {
    return window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode
  })
  expect(finalValue).toBe(initialValue)
})

test('preview mode can be forced via store API and checkbox reflects it', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Drive the store to a known state.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
  })

  await openEditorPanel(page)

  const checkbox = page.getByTestId('settings-panel-editor').locator('input[type="checkbox"]').first()
  // With store set to false, checkbox should be unchecked.
  await expect(checkbox).not.toBeChecked()

  // Flip via store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setNotesOpenInPreviewMode(true)
  })

  // React should re-render the checkbox to checked.
  await expect(checkbox).toBeChecked({ timeout: 3_000 })
})
