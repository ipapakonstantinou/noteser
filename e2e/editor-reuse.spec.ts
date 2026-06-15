import { test, expect } from '@playwright/test'

// Verification for the "instant note switch" change: the editor view is now
// REUSED across notes (we dropped key={noteId}) and the per-note effect
// resets history + scroll. This spec proves (a) the .cm-editor DOM node is the
// SAME element before/after a switch (i.e. no remount), (b) content swaps in,
// (c) undo does not cross note boundaries, and reports switch latency.
// Guards against a regression back to the per-note remount.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

test('editor view is reused across notes (no remount) + undo stays per-note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)

  // Seed two notes with distinct bodies.
  const { a, b } = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const a = ns.addNote({ title: 'Alpha', content: 'ALPHA-BODY', folderId: null }).id
    const b = ns.addNote({ title: 'Beta', content: 'BETA-BODY', folderId: null }).id
    return { a, b }
  })

  // Open A and wait for its body to render in the editor.
  await page.evaluate((id) => window.__noteser_test!.stores.workspaceStore.getState().openNote(id), a)
  const cm = page.locator('.cm-editor').first()
  await expect(cm).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('ALPHA-BODY')

  // Stamp the live editor DOM node. If the view remounts on switch, this
  // attribute disappears with the old node.
  await page.evaluate(() => {
    document.querySelector('.cm-editor')?.setAttribute('data-reuse-probe', 'kept')
  })

  // Switch to B and measure how long until B's body is on screen.
  const t0 = await page.evaluate(() => performance.now())
  await page.evaluate((id) => window.__noteser_test!.stores.workspaceStore.getState().openNote(id), b)
  await expect(page.locator('.cm-content')).toContainText('BETA-BODY')
  const switchMs = await page.evaluate((start) => performance.now() - start, t0)

  // The probe must still be on the (same) editor node → no remount.
  const probeSurvived = await page.evaluate(
    () => document.querySelector('.cm-editor')?.getAttribute('data-reuse-probe') === 'kept',
  )
  expect(probeSurvived).toBe(true)
  await expect(page.locator('.cm-content')).not.toContainText('ALPHA-BODY')

  // Undo must NOT pull A's content back: history was cleared on switch.
  // Click into the editor, type, then Ctrl+Z once — it should only revert the
  // text we just typed, never cross into note A.
  await page.locator('.cm-content').click()
  await page.keyboard.type('XYZ')
  await expect(page.locator('.cm-content')).toContainText('BETA-BODYXYZ')
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`)
  // A second undo would, with a leaked history, start replaying the doc-swap
  // (B→A). Press again and assert we never see ALPHA.
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`)
  await expect(page.locator('.cm-content')).not.toContainText('ALPHA-BODY')

  console.log(`[verify] note-switch render latency: ${switchMs.toFixed(1)}ms`)
})
