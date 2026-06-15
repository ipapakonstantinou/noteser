import { test, expect } from '@playwright/test'

// Verification for the tab drag-reorder fix. Reordering "didn't work" because
// the only drop targets were the ~4px gaps between tabs — practically
// impossible to hit. Tabs are now drop targets themselves (insert before/after
// based on which half the cursor is over). This drives a native HTML5 drag via
// a shared DataTransfer and asserts the pane's tab order actually changes.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

test('dragging a tab onto another tab reorders them', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)

  // Open three notes → three tabs in one pane, in order A, B, C.
  const ids = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const a = ns.addNote({ title: 'Alpha', content: 'A', folderId: null }).id
    const b = ns.addNote({ title: 'Beta', content: 'B', folderId: null }).id
    const c = ns.addNote({ title: 'Gamma', content: 'C', folderId: null }).id
    // preview:false so each opens a PERSISTENT tab — preview tabs replace one
    // another, leaving only a single tab.
    ws.openNote(a, { preview: false })
    ws.openNote(b, { preview: false })
    ws.openNote(c, { preview: false })
    return { a, b, c }
  })

  const tabOrder = () =>
    page.evaluate(() =>
      window.__noteser_test!.stores.workspaceStore
        .getState()
        .panes[0].tabs.filter(t => t.kind === 'note').map(t => (t as { noteId: string }).noteId),
    )

  expect(await tabOrder()).toEqual([ids.a, ids.b, ids.c])

  // Simulate a native drag of the tab for `srcNote`, dropping onto `dstNote`
  // at `frac` across its width (0.25 = left half → before, 0.75 = right half →
  // after). Tab DOM ids are `editor-tab-${tab.id}`, so resolve note→tab first.
  const dragTabOnto = (srcNote: string, dstNote: string, frac: number) =>
    page.evaluate(({ srcNote, dstNote, frac }) => {
      const tabs = window.__noteser_test!.stores.workspaceStore.getState().panes[0].tabs as Array<{ id: string; kind: string; noteId?: string }>
      const tabIdFor = (noteId: string) => tabs.find(t => t.kind === 'note' && t.noteId === noteId)!.id
      const src = document.getElementById(`editor-tab-${tabIdFor(srcNote)}`)!
      const dst = document.getElementById(`editor-tab-${tabIdFor(dstNote)}`)!
      const dt = new DataTransfer()
      const fire = (el: Element, type: string, clientX: number) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX, button: 0 }))
      const dstRect = dst.getBoundingClientRect()
      fire(src, 'dragstart', src.getBoundingClientRect().left + 5)
      fire(dst, 'dragover', dstRect.left + dstRect.width * frac)
      fire(dst, 'drop', dstRect.left + dstRect.width * frac)
      fire(src, 'dragend', 0)
    }, { srcNote, dstNote, frac })

  // Drag Alpha onto the RIGHT half of Gamma → Alpha lands after Gamma: [B, C, A].
  await dragTabOnto(ids.a, ids.c, 0.75)
  await expect.poll(tabOrder).toEqual([ids.b, ids.c, ids.a])

  // Drag Alpha (now last) onto the LEFT half of Beta (now first) → [A, B, C].
  await dragTabOnto(ids.a, ids.b, 0.25)
  await expect.poll(tabOrder).toEqual([ids.a, ids.b, ids.c])
})
