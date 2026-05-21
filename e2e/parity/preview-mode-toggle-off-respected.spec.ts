import { test, expect } from '@playwright/test'

// Scenario: preview-mode-toggle-off-respected
//
// When notesOpenInPreviewMode is explicitly set to false, opening a new
// note via openNote() must leave uiStore.isPreviewMode as false.
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
    // Pre-set notesOpenInPreviewMode=false AND onboardingShown=true.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({
          state: { onboardingShown: true, notesOpenInPreviewMode: false },
          version: 2,
        }),
      )
    } catch { /* ignore */ }
  })
}

test('openNote respects notesOpenInPreviewMode=false', async ({ page }) => {
  await addCleanSlateScript(page)
  await page.goto(APP_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForHooks(page)

  // Verify the setting is loaded correctly.
  const settingValue = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode,
  )
  expect(settingValue).toBe(false)

  // Ensure isPreviewMode starts false.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
  })

  // Create and open a fresh note.
  const noteId = await page.evaluate(() => {
    const note = window.__noteser_test!.stores.noteStore.getState().addNote({
      title: 'New note toggled off',
      folderId: null,
      content: 'content',
    })
    return note.id
  })

  await page.evaluate((id) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(id, { preview: true })
  }, noteId)

  // Wait for the dynamic import inside openNote to flush.
  await page.waitForTimeout(150)

  const isPreview = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().isPreviewMode,
  )
  // With notesOpenInPreviewMode=false, the dynamic import should call
  // setPreviewMode(false) — so isPreviewMode stays false.
  expect(isPreview).toBe(false)
})
