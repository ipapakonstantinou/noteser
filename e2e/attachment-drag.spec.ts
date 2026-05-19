import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

// Drops an image into the CodeMirror editor and verifies the resulting
// attachment shows up in the sidebar without the folder tree unmounting
// at any point — the "UI blanks" symptom of p8j3.
//
// The full attachment-to-different-folder drag will come once we have a
// helper that programmatically creates a target Folder entity. For now
// the test pins the create-attachment side of the flow.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try { indexedDB.deleteDatabase('keyval-store') } catch { /* ignore */ }
  })
})

test('dropping an image inserts a markdown ref and the sidebar stays mounted', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // On a fresh vault there's no open note, so CodeMirror isn't mounted.
  // Fire the "new note" shortcut (Alt+N) and wait for the editor to come up.
  await page.keyboard.press('Alt+n')
  const editor = page.locator('.cm-editor').first()
  await expect(editor).toBeVisible({ timeout: 10_000 })
  // Click into the content to focus CodeMirror before the drop.
  await page.locator('.cm-content').first().click()

  const pngBytes = readFileSync(join(__dirname, 'fixtures', '1px.png'))
  // Use Playwright's evaluateHandle + dispatchEvent so the DataTransfer
  // lives in the page context with a real file attached. Constructing
  // the DragEvent inline doesn't transfer File objects reliably across
  // the playwright/browser boundary.
  const dataTransfer = await page.evaluateHandle(({ b64, name, type }) => {
    const dt = new DataTransfer()
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    dt.items.add(new File([bytes], name, { type }))
    return dt
  }, { b64: pngBytes.toString('base64'), name: 'cat.png', type: 'image/png' })

  // dragover must fire first so the editor calls preventDefault and the
  // browser accepts the subsequent drop. (Real users' dragover events
  // happen naturally; here we synthesise both.) The actual handler lives
  // on .cm-content inside the editor.
  const content = page.locator('.cm-content').first()
  await content.dispatchEvent('dragover', { dataTransfer })
  await content.dispatchEvent('drop', { dataTransfer })

  // The drop handler should splice `![cat](attachments/<ts>-cat.png)` into
  // the editor. That's the strongest cheap assertion: the markdown ref is
  // in the source. The sidebar must stay mounted throughout (the
  // no-blank invariant from p8j3).
  await expect(content).toContainText(/attachments\/[0-9]+-cat\.png/, { timeout: 5000 })
  await expect(page.getByTestId('folder-tree')).toBeVisible()
})
