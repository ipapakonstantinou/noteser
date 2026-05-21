import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: tasks-toggle-shortcut
//
// Obsidian behavior: with cursor on a `- [ ] ...` line, Ctrl+L (or
// similar) toggles to `- [x]` and back.
//
// Noteser today: Two shortcut bindings are registered in CodeMirrorEditor.tsx:
//   'Alt-l'       → add/remove the "- [ ]" task bullet (toggle bullet).
//   'Alt-Shift-l' → toggle [x]/[ ] (Obsidian-style with ✅ date stamp).
//
// APP BUG (2026-05-21): 'Alt-Shift-l' is NEVER reached. When the user presses
// Alt+Shift+L, CodeMirror resolves the key chord to 'Alt-l' (because
// Shift+L normalizes to the same key descriptor as L in CodeMirror 6's
// key naming, and 'Alt-l' is listed first in the keymap array and returns
// true on task lines, consuming the event). The fix is to either rename
// 'Alt-l' to 'Alt-L' (uppercase) or reorder 'Alt-Shift-l' before 'Alt-l'.
//
// PARITY GAP: Obsidian uses Ctrl+L; noteser's intended binding is Alt+Shift+L
// but it is shadowed by Alt+L.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function getNoteContent(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId) as { noteId?: string } | undefined
    if (!tab?.noteId) return null
    const note = window.__noteser_test!.stores.noteStore.getState().notes
      .find((n: { id: string }) => n.id === tab.noteId!)
    return (note as { content?: string })?.content ?? null
  })
}

test('APP BUG: Alt+Shift+L is shadowed by Alt+L — removes task bullet instead of toggling [x]', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('- [ ] Write the tests')
  await page.waitForTimeout(400)

  const before = await getNoteContent(page)
  expect(before).toBe('- [ ] Write the tests')

  // Press Alt+Shift+L — intended to toggle to [x] but actually triggers Alt+L.
  await page.keyboard.press('Alt+Shift+l')
  await page.waitForTimeout(400)

  const after = await getNoteContent(page)
  // BUG: should be /- \[x\]/ but instead the task prefix is stripped entirely.
  // If this fails (i.e. [x] IS found), the bug is fixed.
  expect(after).not.toMatch(/- \[x\]/)
  // The bullet is removed (Alt+L behavior).
  expect(after).toBe('Write the tests')
})

test('Alt+L (without Shift) adds task bullet to a plain line', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.locator('.cm-content').first().click()
  await page.keyboard.type('Plain text line')
  await page.waitForTimeout(400)

  await page.keyboard.press('Alt+l')
  await page.waitForTimeout(400)

  const after = await getNoteContent(page)
  // Alt+L on a non-task line prepends "- [ ] ".
  expect(after).toMatch(/^- \[ \] Plain text line/)
})

test('Alt+L on a task line removes the task bullet', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.locator('.cm-content').first().click()
  await page.keyboard.type('- [ ] Remove me')
  await page.waitForTimeout(400)

  await page.keyboard.press('Alt+l')
  await page.waitForTimeout(400)

  const after = await getNoteContent(page)
  // Alt+L removes the "- [ ]" prefix.
  expect(after).toBe('Remove me')
})

test('PARITY GAP: Ctrl+L does NOT toggle tasks (Obsidian binding not implemented)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.locator('.cm-content').first().click()
  await page.keyboard.type('- [ ] Obsidian shortcut test')
  await page.waitForTimeout(400)

  const before = await getNoteContent(page)

  // Press the Obsidian shortcut Ctrl+L. Noteser does not implement this.
  await page.keyboard.press('Control+l')
  await page.waitForTimeout(300)

  const after = await getNoteContent(page)
  // Content should be unchanged — Ctrl+L is not wired up.
  expect(after).toBe(before)
  expect(after).not.toMatch(/- \[x\]/)
})
