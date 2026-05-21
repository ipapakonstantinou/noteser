import { test, expect } from '@playwright/test'

// Scenario: preview-mode-refocus-preserves-user-toggle
//
// When a note is already open and the user has manually set isPreviewMode=false,
// calling openNote() on the SAME note (the "refocus" code path) must NOT
// clobber the user's toggle.
//
// Key insight: when the note is already open in a pane, openNote() takes the
// early-return "focus existing tab" branch and does NOT run the dynamic import
// that would call setPreviewMode(). So isPreviewMode stays wherever the user
// left it.
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

test('refocusing an already-open note does not override user preview toggle', async ({ page }) => {
  await addCleanSlateScript(page)
  await page.goto(APP_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForHooks(page)

  // Create a note.
  const noteId = await page.evaluate(() => {
    const note = window.__noteser_test!.stores.noteStore.getState().addNote({
      title: 'Refocus test',
      folderId: null,
      content: 'body',
    })
    return note.id
  })

  // Open the note (first open — runs dynamic import, sets preview=true since
  // notesOpenInPreviewMode defaults to true).
  await page.evaluate((id) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(id, { preview: true })
  }, noteId)
  await page.waitForTimeout(150)

  // User manually switches to edit mode.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
  })

  const beforeRefocus = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().isPreviewMode,
  )
  expect(beforeRefocus).toBe(false)

  // Call openNote again on the SAME noteId — this should take the early-return
  // refocus branch (note is already open) and NOT trigger the dynamic import.
  await page.evaluate((id) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(id, { preview: true })
  }, noteId)
  await page.waitForTimeout(150)

  const afterRefocus = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().isPreviewMode,
  )

  // The refocus path must not call setPreviewMode — user's false should survive.
  expect(afterRefocus).toBe(false)
})
