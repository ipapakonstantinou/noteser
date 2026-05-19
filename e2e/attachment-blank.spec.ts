import { test, expect } from '@playwright/test'

// Regression test for p8j3 — the "UI blanks during attachment move" bug.
//
// Root cause (since fixed in c65e08b): the per-note ref-rewrite loop
// called `updateNote` once per matching note, each call firing a fresh
// Zustand subscription pass. With N notes referencing the moved
// attachment that's N sequential re-renders for every subscriber —
// FolderTree among them — which visibly flashed the sidebar mid-drag.
//
// The fix replaced the loop with a single batched setState. This test
// pins that behaviour: moving an attachment that N notes reference must
// produce at most ONE notes-array reference change.
//
// If the fix is reverted (per-note updateNote loop), this test fails
// because the noteStore notes ref would change N times.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try { indexedDB.deleteDatabase('keyval-store') } catch { /* ignore */ }
  })
})

test('moving an attachment that N notes reference triggers exactly one noteStore notes-ref change', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  // Wait for installTestHooks to run.
  await page.waitForFunction(() => typeof window.__noteser_test !== 'undefined', null, { timeout: 5000 })

  const stateChanges = await page.evaluate(async () => {
    const t = window.__noteser_test
    if (!t) throw new Error('__noteser_test not exposed')
    const { noteStore } = t.stores
    const { putAttachmentAtPath, moveAttachmentAndRewriteRefs } = t.attachments

    // Seed five notes — three reference the attachment, two don't. The
    // batched fix should produce a single setState; the buggy per-note
    // path would produce three.
    noteStore.getState().addNote({ title: 'A', content: '![](attachments/test.png) intro' })
    noteStore.getState().addNote({ title: 'B', content: 'no refs here' })
    noteStore.getState().addNote({ title: 'C', content: 'two ![alt](attachments/test.png) and ![](attachments/test.png) again' })
    noteStore.getState().addNote({ title: 'D', content: 'also no refs' })
    noteStore.getState().addNote({ title: 'E', content: 'tail ![x](attachments/test.png)' })

    // Seed the actual attachment in IDB so moveAttachment can find it.
    const blob = new Blob([Uint8Array.from([0])], { type: 'image/png' })
    await putAttachmentAtPath('attachments/test.png', blob)

    // Snapshot the current notes-array reference and start counting
    // changes from this point forward.
    let lastNotesRef = noteStore.getState().notes
    let refChanges = 0
    const unsub = noteStore.subscribe(state => {
      if (state.notes !== lastNotesRef) {
        refChanges++
        lastNotesRef = state.notes
      }
    })

    try {
      await moveAttachmentAndRewriteRefs('attachments/test.png', 'images/test.png')
    } finally {
      unsub()
    }

    // Read the post-move notes so the test can also confirm functional
    // correctness — every referencing note got rewritten.
    const after = noteStore.getState().notes
    const remainingOldRefs = after.filter(n =>
      !n.isDeleted && n.content.includes('attachments/test.png'),
    ).length
    const newRefCount = after.filter(n =>
      !n.isDeleted && n.content.includes('images/test.png'),
    ).length

    return { refChanges, remainingOldRefs, newRefCount }
  })

  // Functional correctness first — every referencing note got its ref
  // rewritten to the new path.
  expect(stateChanges.remainingOldRefs).toBe(0)
  expect(stateChanges.newRefCount).toBe(3)
  // The regression assertion: at most one notes-array reference change
  // happened during the move. Without the batching fix this would be 3
  // (one per referencing note).
  expect(stateChanges.refChanges).toBeLessThanOrEqual(1)
})

test('the folder tree element survives the entire attachment-move flow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => typeof window.__noteser_test !== 'undefined', null, { timeout: 5000 })

  // Capture a handle to the folder-tree element BEFORE the move. If
  // anything later unmounts/remounts it, isConnected goes false.
  const initialHandle = await page.getByTestId('folder-tree').elementHandle()
  expect(initialHandle).not.toBeNull()

  await page.evaluate(async () => {
    const t = window.__noteser_test
    if (!t) throw new Error('__noteser_test not exposed')
    t.stores.noteStore.getState().addNote({
      title: 'with-img',
      content: '![](attachments/x.png) some text',
    })
    const blob = new Blob([Uint8Array.from([0])], { type: 'image/png' })
    await t.attachments.putAttachmentAtPath('attachments/x.png', blob)
    await t.attachments.moveAttachmentAndRewriteRefs(
      'attachments/x.png',
      'images/x.png',
    )
  })

  // The original folder-tree element handle must still be connected to
  // the DOM. A momentary unmount/remount during the move (which is what
  // an over-eager render storm could trigger) would break this.
  const stillConnected = await initialHandle!.evaluate((el) => el.isConnected)
  expect(stillConnected).toBe(true)
})
