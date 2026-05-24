import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: delete-note-confirms
//
// Obsidian behavior: Delete from the context menu surfaces a confirm
// modal. Enter or Delete (or Backspace) on the modal accepts; Escape
// cancels. Default behaviour is "move to trash" (recoverable).
//
// Noteser today: DeleteConfirmModal listens window-level for
// Enter / Delete / Backspace and confirms via `handleDelete()`.
// The cancel button + Escape both close it. The trash mode default
// is `trash`, so the button label is "Move to Trash" and the note
// gets soft-deleted (isDeleted: true).
//
// 2026-05-21 NOTE — these tests originally failed because of a bug
// in VaultSettingsConflictModal that crashed on any modal open. The
// bug was fixed in the same commit; the regression test lives in
// src/__tests__/vaultSettingsConflictModal.test.tsx. Leaving this
// note for archaeological context.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function createOneNote(page: import('@playwright/test').Page) {
  await page.getByTestId('ribbon-item-new-note').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)
}

test('context-menu Delete opens a confirm modal; clicking the danger button soft-deletes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await createOneNote(page)

  // Right-click the note row to open the sidebar context menu.
  await page.getByTestId('note-row').first().click({ button: 'right' })

  // The "Delete" button in the menu is the last red item — match by text.
  await page.getByRole('button', { name: 'Delete' }).click()

  // Confirm modal mounts with the "Move to Trash" action (default trash mode).
  await expect(page.getByTestId('delete-confirm')).toBeVisible()
  await expect(page.getByTestId('delete-confirm')).toHaveText(/Move to Trash/)
  await page.getByTestId('delete-confirm').click()

  // After confirm: the row leaves the main tree (note is soft-deleted)
  // and the modal closes.
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
  // The note still exists in the trash synthetic folder, so the only
  // visible note-row in the *non-trash* default view should now be 0.
  // The `.trash` folder is collapsed by default — note rows under
  // it stay un-rendered, so the count check is reliable.
  await expect(page.getByTestId('note-row')).toHaveCount(0)
  // Confirm the soft-delete via the store rather than the synthetic
  // folder testid — the trash row only renders when there are
  // deleted notes, and the rendering can lag a tick behind the state
  // update. Store-state assertion is race-free.
  const deletedCount = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.filter(n => n.isDeleted).length
  })
  expect(deletedCount).toBe(1)
})

test('Enter on the confirm modal also deletes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await createOneNote(page)
  await page.getByTestId('note-row').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('delete-confirm')).toBeVisible()

  // Press Enter; the window-level listener fires handleDelete().
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
  await expect(page.getByTestId('note-row')).toHaveCount(0)
})

test('Delete key on the confirm modal also deletes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await createOneNote(page)
  await page.getByTestId('note-row').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('delete-confirm')).toBeVisible()

  await page.keyboard.press('Delete')
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
  await expect(page.getByTestId('note-row')).toHaveCount(0)
})

test('Escape on the confirm modal cancels (note stays)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await createOneNote(page)
  await page.getByTestId('note-row').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('delete-confirm')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
  // Note still present in the active tree.
  await expect(page.getByTestId('note-row')).toHaveCount(1)
})
