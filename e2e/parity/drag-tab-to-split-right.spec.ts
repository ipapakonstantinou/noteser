import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian/VS Code-parity scenario: drag a tab onto a pane to split it.
//
// Semantics (reworked for #184 — the old "splitting the only tab leaves
// an empty husk pane" behaviour was reported broken by the owner):
//   - Splitting a pane's ONLY tab is a no-op (the emptied source would
//     collapse immediately, so nothing would change).
//   - Splitting with 2+ tabs moves the tab into a new pane on the
//     requested side; no pane is ever left empty.
//   - Dragging a tab over a pane shows a 5-region overlay: the outer
//     fifths split toward that edge, the middle moves the tab into the
//     pane. Drops are handled by workspaceStore.dropTabOnPane.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function seedTwoNotesOpen(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const a = ns.addNote({ folderId: null })
    ns.updateNote(a.id, { title: 'Alpha' })
    const b = ns.addNote({ folderId: null })
    ns.updateNote(b.id, { title: 'Beta' })
    ws.openNote(a.id, { preview: false })
    ws.openNote(b.id, { preview: false })
  })
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
}

test('splitting the only tab is a no-op — no empty pane is created', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const note = ns.addNote({ folderId: null })
    ns.updateNote(note.id, { title: 'Split Me' })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    ws.splitTabRight(ws.panes[0].activeTabId!)
  })

  const panes = await page.evaluate(() =>
    window.__noteser_test!.stores.workspaceStore.getState().panes.map(p => p.tabs.length))
  expect(panes).toEqual([1])
})

test('splitTabRight with two tabs: source keeps one, new pane gets the other, none empty', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedTwoNotesOpen(page)

  await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    ws.splitTabRight(ws.panes[0].activeTabId!)
  })

  const state = await page.evaluate(() => {
    const s = window.__noteser_test!.stores.workspaceStore.getState()
    return {
      counts: s.panes.map(p => p.tabs.length),
      layoutKind: s.layout.kind,
      direction: s.layout.kind === 'split' ? s.layout.direction : null,
    }
  })
  expect(state.counts).toEqual([1, 1])
  expect(state.layoutKind).toBe('split')
  expect(state.direction).toBe('horizontal')

  // Both editors actually render side by side.
  await expect(page.locator('.cm-editor')).toHaveCount(2)
})

test('drag a tab over a pane: overlay shows the region highlight and drop splits', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedTwoNotesOpen(page)

  const tabId = await page.evaluate(() =>
    window.__noteser_test!.stores.workspaceStore.getState().panes[0].tabs[0].id)

  const dataTransfer = await page.evaluateHandle((tId) => {
    const dt = new DataTransfer()
    dt.setData('application/x-noteser-tab', tId)
    dt.effectAllowed = 'move'
    return dt
  }, tabId)

  // Window-level dragstart flips useTabDragActive → the overlay mounts.
  await page.evaluate((dt) => {
    window.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, dataTransfer)
  const overlay = page.getByTestId('pane-drop-overlay')
  await expect(overlay).toBeVisible()

  // Dragover near the right edge highlights the right half…
  const box = (await overlay.boundingBox())!
  await overlay.dispatchEvent('dragover', {
    dataTransfer,
    clientX: Math.round(box.x + box.width * 0.95),
    clientY: Math.round(box.y + box.height * 0.5),
  })
  await expect(page.getByTestId('pane-drop-right')).toBeVisible()

  // …and dropping there splits horizontally with the tab on the right.
  await overlay.dispatchEvent('drop', {
    dataTransfer,
    clientX: Math.round(box.x + box.width * 0.95),
    clientY: Math.round(box.y + box.height * 0.5),
  })

  const after = await page.evaluate(() => {
    const s = window.__noteser_test!.stores.workspaceStore.getState()
    return {
      counts: s.panes.map(p => p.tabs.length),
      direction: s.layout.kind === 'split' ? s.layout.direction : null,
      empty: s.panes.some(p => p.tabs.length === 0),
    }
  })
  expect(after.counts.length).toBe(2)
  expect(after.direction).toBe('horizontal')
  expect(after.empty).toBe(false)
  await expect(page.locator('.cm-editor')).toHaveCount(2)
})

test('center drop on another pane MOVES the tab there and collapses the emptied source', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedTwoNotesOpen(page)

  // Make a 2-pane layout first: p1=[Alpha], p2=[Beta].
  await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    ws.splitTabRight(ws.panes[0].activeTabId!)
  })

  // Center-drop Alpha's tab onto the SECOND pane via the store API the
  // overlay invokes (region computation is covered by the test above).
  await page.evaluate(() => {
    const s = window.__noteser_test!.stores.workspaceStore.getState()
    const sourceTab = s.panes[0].tabs[0]
    s.dropTabOnPane(sourceTab.id, s.panes[1].id, 'center')
  })

  const after = await page.evaluate(() => {
    const s = window.__noteser_test!.stores.workspaceStore.getState()
    return { paneCount: s.panes.length, tabCounts: s.panes.map(p => p.tabs.length), layoutKind: s.layout.kind }
  })
  expect(after.paneCount).toBe(1)
  expect(after.tabCounts).toEqual([2])
  expect(after.layoutKind).toBe('leaf')
})
