import { test, expect } from '@playwright/test'

// Scenario: preview-mode-default-on
//
// settingsStore.notesOpenInPreviewMode defaults to true.
// When a fresh note is opened via workspaceStore.openNote(), the dynamic
// import inside openNote should call uiStore.setPreviewMode(true).
//
// Target: https://noteser.thetechjon.com (deployed app, absolute URLs)

const APP_URL = 'https://noteser.thetechjon.com'

/** Wait for `window.__noteser_test` to be available (post-hydration). */
async function waitForHooks(page: import('@playwright/test').Page, timeout = 15_000) {
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout },
  )
}

/** Clear localStorage + IDB before the page loads. */
function addCleanSlateScript(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-set onboardingShown so the modal doesn't block.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

test.describe('preview-mode-default-on', () => {
  test('notesOpenInPreviewMode defaults to true', async ({ page }) => {
    await addCleanSlateScript(page)
    await page.goto(APP_URL)
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
    await waitForHooks(page)

    const defaultValue = await page.evaluate(() =>
      window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode,
    )
    expect(defaultValue).toBe(true)
  })

  test('openNote sets isPreviewMode to true (default setting)', async ({ page }) => {
    await addCleanSlateScript(page)
    await page.goto(APP_URL)
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
    await waitForHooks(page)

    // Ensure isPreviewMode starts false (clean state).
    await page.evaluate(() => {
      window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
    })

    // Create a note and open it.
    const noteId = await page.evaluate(() => {
      const { addNote } = window.__noteser_test!.stores.noteStore.getState()
      const note = addNote({ title: 'Test note', folderId: null, content: 'hello' })
      return note.id
    })

    // openNote triggers the dynamic import side-effect.
    await page.evaluate((id) => {
      window.__noteser_test!.stores.workspaceStore.getState().openNote(id, { preview: true })
    }, noteId)

    // Wait for the dynamic import microtask to flush.
    await page.waitForTimeout(150)

    const isPreview = await page.evaluate(() =>
      window.__noteser_test!.stores.uiStore.getState().isPreviewMode,
    )
    expect(isPreview).toBe(true)
  })
})
