import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: create-note-via-button
//
// Obsidian behavior: clicking the "new note" toolbar button (or pressing
// Alt+N) creates an untitled note in the current folder, opens it in the
// editor, and puts focus where the user can immediately start typing the
// title.
//
// Noteser today: the FolderTreeToolbar exposes a `+` doc icon at the
// top of the sidebar tree with `title="New note (Alt+N)"`. It calls
// `addNote({ folderId: null })` and `openNote(note.id, { preview: false })`.
// The new note's title defaults to "Untitled Note" and the editor mounts
// with a CodeMirror surface plus a title <input> in EditorHeader.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('toolbar + button creates an untitled note, opens it, sidebar row appears', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Pre-state: empty-state copy is visible on a clean vault.
  await expect(page.getByText('No notes yet')).toBeVisible()

  // Click the toolbar's "+ new note" button. The icon button itself has
  // no testid but the surrounding button has title="New note (Alt+N)".
  await page.getByTitle('New note (Alt+N)').click()

  // A sidebar note-row appears for the new note.
  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await expect(page.getByTestId('note-row').first()).toContainText('Untitled Note')

  // The editor mounts and shows the title input populated with the
  // default title, plus a focused CodeMirror surface ready for content.
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
  const titleInput = page.getByPlaceholder('Note title...').first()
  await expect(titleInput).toHaveValue('Untitled Note')
})

test('Alt+N shortcut also creates a new note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Focus needs to live somewhere outside an input for shortcuts to
  // fire (Alt+N is in the non-input branch). Click the empty tree.
  await page.getByTestId('folder-tree').click()
  await page.keyboard.press('Alt+n')

  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
})

test('clicking + twice creates two distinct notes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  const addBtn = page.getByTitle('New note (Alt+N)')
  await addBtn.click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await addBtn.click()
  await expect(page.getByTestId('note-row')).toHaveCount(2)
})
