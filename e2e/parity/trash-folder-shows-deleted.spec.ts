import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: trash-folder-shows-deleted
//
// Obsidian behavior: trashed notes appear in a ".trash" folder at the top of
// the tree; they look like normal rows; right-click → Restore.
//
// Noteser today: a synthetic ".trash" collapsible row appears when
// isDeleted notes exist (in the notes view). The dedicated Trash view
// (currentView === 'trash') shows all deleted notes with inline Restore
// and Delete buttons.
//
// APP BUG (2026-05-21): When ALL active notes are deleted, FolderTree
// takes an early-return "No notes yet" branch that does NOT include the
// TrashSyntheticFolder component. Bug is in FolderTree.tsx line ~747: the
// condition `rootFolders.length === 0 && rootNotes.length === 0 && attachmentMeta.length === 0`
// needs `&& deletedNotes.length === 0` to guard properly.
//
// PARITY GAP 2 (2026-05-21): The right-click context menu on a deleted note
// does NOT include a "Restore" option. Restore is only available via inline
// buttons in the dedicated Trash view (icon strip → Trash) or via the
// notes-view TrashSyntheticFolder which uses a different render path.
//
// WORKAROUND IN TESTS: seed two notes — delete one, keep one active — so
// the FolderTree takes the full render path that includes TrashSyntheticFolder.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('APP BUG: when all notes deleted, trash-synthetic-folder does not render (empty-state early return skips it)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Soft-delete the only note — should trigger empty-state path.
  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  await page.getByTestId('note-row').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('delete-confirm')).toBeVisible()
  await page.getByTestId('delete-confirm').click()

  // The active note row should be gone.
  await expect(page.getByTestId('note-row')).toHaveCount(0)

  // Note is soft-deleted in store.
  const deletedCount = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.filter((n: { isDeleted: boolean }) => n.isDeleted).length
  })
  expect(deletedCount).toBe(1)

  // BUG: the trash synthetic folder does NOT appear because FolderTree
  // takes the empty-state early-return path that omits TrashSyntheticFolder.
  // Once fixed, this should be flipped to toBeVisible().
  await expect(page.getByTestId('trash-synthetic-folder')).toHaveCount(0)
})

test('trashed note appears in the synthetic .trash folder when there is also an active note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed two notes: delete one, keep one active — avoids the empty-state bug.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n1 = store.addNote({ folderId: null })
    store.updateNote(n1.id, { title: 'Note to Delete' })
    const n2 = store.addNote({ folderId: null })
    store.updateNote(n2.id, { title: 'Active Note' })
    store.deleteNotes([n1.id])
  })

  // One active note remains.
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // The synthetic .trash folder should now appear.
  await expect(page.getByTestId('trash-synthetic-folder')).toBeVisible()
  await expect(page.getByTestId('trash-synthetic-folder')).toContainText('.trash')
})

test('expanding .trash reveals the deleted note row', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed 2 notes; delete one.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n1 = store.addNote({ folderId: null })
    store.updateNote(n1.id, { title: 'To Be Trashed' })
    const n2 = store.addNote({ folderId: null })
    store.updateNote(n2.id, { title: 'Stays Active' })
    store.deleteNotes([n1.id])
  })

  // One active note, one deleted.
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // Trash folder should be present.
  await expect(page.getByTestId('trash-synthetic-folder')).toBeVisible()

  // Click the expand toggle inside .trash.
  const trashToggle = page.getByTestId('trash-synthetic-folder').locator('button').first()
  await trashToggle.click()

  // The deleted note should now be visible as a note-row inside .trash.
  await expect(page.getByTestId('note-row')).toHaveCount(2) // 1 active + 1 in trash
  await expect(page.getByTestId('note-row').filter({ hasText: 'To Be Trashed' })).toBeVisible()
})

test('PARITY GAP: right-click on deleted note shows no Restore option in context menu; use Trash view instead', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed 2 notes, soft-delete one.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n1 = store.addNote({ folderId: null })
    store.updateNote(n1.id, { title: 'Deleted Note' })
    const n2 = store.addNote({ folderId: null })
    store.updateNote(n2.id, { title: 'Active Note' })
    store.deleteNotes([n1.id])
  })

  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await expect(page.getByTestId('trash-synthetic-folder')).toBeVisible()

  // Expand .trash.
  await page.getByTestId('trash-synthetic-folder').locator('button').first().click()
  const deletedRow = page.getByTestId('note-row').filter({ hasText: 'Deleted Note' })
  await expect(deletedRow).toBeVisible()

  // Right-click the deleted note — context menu should open but NO Restore option.
  await deletedRow.click({ button: 'right' })
  const restoreBtn = page.getByRole('button', { name: 'Restore' })
  // PARITY GAP: Restore is not in the right-click context menu.
  // Count 0 confirms the gap. If ever non-zero, the gap is fixed.
  await expect(restoreBtn).toHaveCount(0)

  // Close context menu.
  await page.keyboard.press('Escape')
})

test('Restore works via the dedicated Trash view (currentView=trash)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed and soft-delete a note.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n = store.addNote({ folderId: null })
    store.updateNote(n.id, { title: 'Restoreable Note' })
    store.deleteNotes([n.id])
  })

  // Switch to Trash view via the store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setCurrentView('trash')
  })

  // The trash view should show the deleted note with inline Restore button.
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Restore' }).click()

  // Note is restored — no longer deleted.
  const deletedCount = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.filter((n: { isDeleted: boolean }) => n.isDeleted).length
  })
  expect(deletedCount).toBe(0)
})
