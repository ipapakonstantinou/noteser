import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: drag-note-into-folder
//
// Obsidian behavior: drag a note row onto a folder row → note moves into
// that folder. Drop on empty space = move to root.
//
// Noteser today: FolderTree uses useTreeDragDrop hook. Note drag uses
// 'application/x-noteser-note' MIME. Drop on a folder calls
// moveNoteToFolder(noteId, folderId). The hook reads draggedItemRef which
// is set in React's onDragStart handler.
//
// HTML5 drag is flaky with Playwright — we dispatch events manually via the
// page JS, seeding state through the store directly for the note+folder, then
// simulating dragstart on the note row and drop on the folder row.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('dragging a note onto a folder moves it into that folder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Create a note and a folder via store API for reliable seeding.
  const { noteId, folderId } = await page.evaluate(() => {
    const noteStore = window.__noteser_test!.stores.noteStore.getState()
    const folderStore = window.__noteser_test!.stores.folderStore.getState()
    const note = noteStore.addNote({ folderId: null })
    const folder = folderStore.addFolder({ parentId: null, name: 'Target Folder' })
    return { noteId: note.id, folderId: folder.id }
  })

  // Wait for sidebar to reflect the state.
  await expect(page.getByTestId('note-row')).toBeVisible()
  await expect(page.getByTestId('folder-row')).toBeVisible()

  // Use DataTransfer + dispatchEvent pattern (same as attachment-drag.spec.ts).
  const noteRow = page.getByTestId('note-row').first()
  const folderRow = page.getByTestId('folder-row').first()

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    return dt
  })

  // Set the note MIME on the DataTransfer.
  await page.evaluate(
    ({ nId, dt }) => {
      dt.setData('application/x-noteser-note', nId)
    },
    { nId: noteId, dt: dataTransfer },
  )

  // Dispatch dragstart on the note row.
  await noteRow.dispatchEvent('dragstart', { dataTransfer })
  // Dispatch dragover on the folder row (needed for React's drop to accept).
  await folderRow.dispatchEvent('dragover', { dataTransfer })
  // Dispatch drop on the folder row.
  await folderRow.dispatchEvent('drop', { dataTransfer })
  // Dispatch dragend on the note row to clean up.
  await noteRow.dispatchEvent('dragend', { dataTransfer })

  // Verify via store state that the note now belongs to the target folder.
  const noteFolderId = await page.evaluate(
    ({ nId }) => {
      const notes = window.__noteser_test!.stores.noteStore.getState().notes
      return notes.find((n: { id: string }) => n.id === nId)?.folderId ?? null
    },
    { nId: noteId },
  )
  expect(noteFolderId).toBe(folderId)
})

test('dragging a note to root area moves it to root (folderId = null)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a folder and a note inside it.
  // addFolder auto-expands the folder, so the note row is immediately visible.
  const { noteId } = await page.evaluate(() => {
    const noteStore = window.__noteser_test!.stores.noteStore.getState()
    const folderStore = window.__noteser_test!.stores.folderStore.getState()
    const folder = folderStore.addFolder({ parentId: null, name: 'Source Folder' })
    const note = noteStore.addNote({ folderId: folder.id })
    return { noteId: note.id, folderId: folder.id }
  })

  // addFolder auto-expands the folder, so note-row should already be visible.
  await expect(page.getByTestId('note-row')).toBeVisible()

  const noteRow = page.getByTestId('note-row').first()
  const folderTree = page.getByTestId('folder-tree')

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await page.evaluate(
    ({ nId, dt }) => { dt.setData('application/x-noteser-note', nId) },
    { nId: noteId, dt: dataTransfer },
  )

  await noteRow.dispatchEvent('dragstart', { dataTransfer })
  await folderTree.dispatchEvent('dragover', { dataTransfer })
  await folderTree.dispatchEvent('drop', { dataTransfer })
  await noteRow.dispatchEvent('dragend', { dataTransfer })

  // Note should now have folderId = null.
  const noteFound = await page.evaluate(
    ({ nId }) => {
      const notes = window.__noteser_test!.stores.noteStore.getState().notes
      const note = notes.find((n: { id: string }) => n.id === nId)
      if (!note) return 'NOTE_NOT_FOUND'
      // Return folderId as a JSON-safe value: 'null' string if null, else the id.
      return note.folderId === null ? '__root__' : note.folderId
    },
    { nId: noteId },
  )
  // '__root__' means the note is at root (folderId === null).
  expect(noteFound).toBe('__root__')
})
