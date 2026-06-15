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

test('switching right after typing shows the new note (no stale-content race)', async ({ page }) => {
  // Regression for the "16 and 17 look the same, fixes on reload" bug
  // (2026-06-15): react-codemirror DEFERS its value-sync for 200ms after a
  // keystroke (typing latch), so switching notes immediately after typing left
  // the previous note's text on screen. The per-note layout effect now drives
  // the swap deterministically, independent of that latch.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)

  const { a, b } = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const a = ns.addNote({ title: 'June16', content: 'CONTENT-SIXTEEN', folderId: null }).id
    const b = ns.addNote({ title: 'June17', content: 'CONTENT-SEVENTEEN', folderId: null }).id
    ws.openNote(a, { preview: false })
    ws.openNote(b, { preview: false })
    return { a, b }
  })

  // Focus A, type (arming the 200ms typing latch), then switch to B WITHOUT
  // waiting for the latch to settle.
  await page.evaluate((id) => window.__noteser_test!.stores.workspaceStore.getState().focusTab(
    window.__noteser_test!.stores.workspaceStore.getState().panes[0].tabs.find(t => t.kind === 'note' && (t as { noteId: string }).noteId === id)!.id,
  ), a)
  await expect(page.locator('.cm-content')).toContainText('CONTENT-SIXTEEN')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End') // cursor to end of the single content line
  await page.keyboard.type(' EDIT-A')
  // Immediately switch to B (within the 200ms latch window).
  await page.evaluate((id) => window.__noteser_test!.stores.workspaceStore.getState().focusTab(
    window.__noteser_test!.stores.workspaceStore.getState().panes[0].tabs.find(t => t.kind === 'note' && (t as { noteId: string }).noteId === id)!.id,
  ), b)

  // B's body must be showing — NOT A's content/edit. (Pre-fix this stayed
  // stale, sometimes until reload.)
  await expect(page.locator('.cm-content')).toContainText('CONTENT-SEVENTEEN')
  await expect(page.locator('.cm-content')).not.toContainText('CONTENT-SIXTEEN')
  await expect(page.locator('.cm-content')).not.toContainText('EDIT-A')

  // And A kept the edit (switching saved it, didn't lose or cross it).
  await page.evaluate((id) => window.__noteser_test!.stores.workspaceStore.getState().focusTab(
    window.__noteser_test!.stores.workspaceStore.getState().panes[0].tabs.find(t => t.kind === 'note' && (t as { noteId: string }).noteId === id)!.id,
  ), a)
  await expect(page.locator('.cm-content')).toContainText('CONTENT-SIXTEEN EDIT-A')
})
