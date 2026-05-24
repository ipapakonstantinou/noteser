import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: live-preview-tags
//
// Obsidian behavior: #tag patterns inline are styled as pills both in
// edit mode and rendered (preview) mode.
//
// Noteser today:
//   - Edit mode: markdownLivePreview.ts applies `.cm-lp-tag` decoration
//     via the `inlineTag` Decoration.mark.
//   - Rendered mode: EditorContent traverses the DOM and wraps #tag
//     text nodes in <span class="preview-tag">.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('typing #tag in the editor gives the token a cm-lp-tag decoration', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('ribbon-item-new-note').click()
  // Notes open in rendered preview mode by default (notesOpenInPreviewMode
  // = true since 2026-05). Toggle to edit mode so the CodeMirror surface
  // mounts and the live-preview decorations apply.
  await page.getByTestId('editor-header-preview-toggle').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('#productivity this is a tagged line')

  // The live-preview extension should have decorated the #productivity token
  // with the cm-lp-tag class (applied to a cm-line span or a Decoration.mark span).
  await expect(page.locator('.cm-lp-tag')).toHaveCount(1)
  await expect(page.locator('.cm-lp-tag').first()).toContainText('#productivity')
})

test('multiple #tags on one line get individual cm-lp-tag decorations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('ribbon-item-new-note').click()
  await page.getByTestId('editor-header-preview-toggle').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('Note with #tag1 and #tag2 inline')

  await expect(page.locator('.cm-lp-tag')).toHaveCount(2)
})

test('#tag in rendered preview mode gets a preview-tag span', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a note with a #tag via the store (avoids debounce race).
  const noteId = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content: 'Hello #world this is a tagged note' })
    return note.id
  })

  // Open the note in preview mode via the store.
  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  }, noteId)

  // Wait for the preview container to render.
  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  // The rendered preview should have a .preview-tag span for #world.
  await expect(page.locator('.preview-tag')).toHaveCount(1)
  await expect(page.locator('.preview-tag').first()).toContainText('#world')
})

test('#fragment-word does NOT get a cm-lp-tag (only standalone # starts tags)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('ribbon-item-new-note').click()
  await page.getByTestId('editor-header-preview-toggle').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  // A # at start of line is a heading, not a tag.
  await page.keyboard.type('# This is a heading not a tag')

  // Should NOT get cm-lp-tag — it should get cm-lp-h1 instead.
  await expect(page.locator('.cm-lp-tag')).toHaveCount(0)
  await expect(page.locator('.cm-lp-h1')).toHaveCount(1)
})
