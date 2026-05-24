import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: single-click-preview-double-click-pin
//
// Obsidian behavior: single-click a note in the sidebar opens a "preview"
// tab (italic title) that gets replaced if you click another note. Double-
// click pins the tab so subsequent single-clicks open new tabs instead of
// replacing it. Typing into a preview tab auto-promotes it to pinned.
//
// Noteser today: FolderTree.handleNoteClick calls openNote(id, { preview: true })
// after a 200ms guard; handleNoteDoubleClick calls openNote(id, { preview: false }).
// Tab.isPreview=true renders italic in TabBar.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

// Seed 3 notes via the API and return their ids.
async function seedNotes(page: import('@playwright/test').Page, count: number): Promise<string[]> {
  return page.evaluate((n) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const note = store.addNote({ folderId: null })
      store.updateNote(note.id, { title: `Note ${i + 1}` })
      ids.push(note.id)
    }
    return ids
  }, count)
}

test('single-click opens a preview (italic) tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await seedNotes(page, 1)
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // Single-click the note row.
  await page.getByTestId('note-row').first().click()

  // Wait for the editor to open. `.cm-editor` mounts underneath the
  // rendered-preview overlay, so it is visible regardless of preview mode.
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  // The tab should be a preview tab (isPreview=true).
  const isPreview = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const activeTab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (activeTab as { isPreview?: boolean })?.isPreview ?? null
  })
  expect(isPreview).toBe(true)

  // The tab title in the tab bar should be italic.
  const italicSpan = page.locator('[class*="italic"]').first()
  await expect(italicSpan).toBeVisible()
})

test('single-clicking another note replaces the preview tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await seedNotes(page, 2)
  await expect(page.getByTestId('note-row')).toHaveCount(2)

  // Click the first note → preview tab.
  await page.getByTestId('note-row').nth(0).click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const tabsBefore = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    return ws.panes[0]?.tabs.length ?? 0
  })
  expect(tabsBefore).toBe(1)

  // Click the second note → should replace the preview tab (still 1 tab).
  await page.getByTestId('note-row').nth(1).click()

  // Wait a tick for the state to settle.
  await page.waitForTimeout(300)

  const tabsAfter = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    return ws.panes[0]?.tabs.length ?? 0
  })
  expect(tabsAfter).toBe(1)
})

test('double-click triggers inline rename (not pin)', async ({ page }) => {
  // Noteser maps double-click to inline-rename (matching Obsidian's
  // double-click-on-title behaviour). Pin = right-click → Pin OR the
  // auto-promote-preview-on-typing path. See
  // e2e/parity/rename-note-inline.spec.ts for the rename coverage.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await seedNotes(page, 1)
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  await page.getByTestId('note-row').first().dblclick()
  await page.waitForTimeout(150)

  const rename = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().renameRequest,
  )
  expect(rename?.type).toBe('note')
  // The rename input appears inline; CodeMirror does NOT mount.
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(1)
})

test('typing into a preview tab auto-promotes it to pinned', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await seedNotes(page, 1)
  // Single-click → preview tab.
  await page.getByTestId('note-row').first().click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  // Verify it's a preview tab.
  const isPreviewBefore = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (tab as { isPreview?: boolean })?.isPreview ?? null
  })
  expect(isPreviewBefore).toBe(true)

  // Notes open in rendered preview by default; the preview overlay sits on
  // top of the CodeMirror surface and intercepts clicks. Flip to edit mode
  // via the store (deterministic — avoids racing openNote's async
  // preview-mode default) and wait for the overlay to detach before typing.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
  })
  await expect(page.locator('.prose')).toHaveCount(0)

  // Type a character into the CodeMirror editor.
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('x')

  // CodeMirrorEditor has a 300ms debounce on onSave; promoteTab is called
  // inside onContentChange which is triggered by the debounced save.
  // Wait long enough for the debounce to fire + React to re-render.
  await page.waitForTimeout(600)

  // The tab should now be promoted (isPreview=false).
  const isPreviewAfter = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (tab as { isPreview?: boolean })?.isPreview ?? null
  })
  expect(isPreviewAfter).toBe(false)
})
