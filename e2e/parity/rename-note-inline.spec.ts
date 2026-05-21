import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: rename-note-inline
//
// Obsidian behavior: double-click a note title in the sidebar → the title
// becomes an editable text input in place. Enter commits, Escape cancels.
//
// Noteser today: double-click does NOT open an inline rename (deliberate).
// Rename is only available via context-menu → Rename. This spec verifies the
// context-menu path works AND flags the double-click gap as a parity
// divergence.
//
// PARITY GAP: double-click on a note row does not trigger rename; it pins
// the tab (opens as non-preview). Obsidian users who rely on double-click to
// rename will need to use right-click → Rename instead.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('context-menu Rename makes the title editable and Enter commits', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Create a note.
  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // Right-click the note row to open the context menu.
  await page.getByTestId('note-row').first().click({ button: 'right' })

  // The context menu should have a Rename option.
  const renameBtn = page.getByRole('button', { name: 'Rename' })
  await expect(renameBtn).toBeVisible()
  await renameBtn.click()

  // The note title should now be editable inline via EditableText.
  // EditableText renders an <input> when isEditing=true.
  const inlineInput = page.getByTestId('note-row').first().locator('input')
  await expect(inlineInput).toBeVisible()

  // Clear and type a new title.
  await inlineInput.fill('My Renamed Note')
  await page.keyboard.press('Enter')

  // After Enter the input should close and the new title should appear.
  await expect(page.getByTestId('note-row').first()).toContainText('My Renamed Note')
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(0)
})

test('context-menu Rename → Escape cancels, title unchanged', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)
  const originalTitle = await page.getByTestId('note-row').first().textContent()

  await page.getByTestId('note-row').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Rename' }).click()

  const inlineInput = page.getByTestId('note-row').first().locator('input')
  await expect(inlineInput).toBeVisible()
  await inlineInput.fill('This Should Not Stick')
  await page.keyboard.press('Escape')

  // Input should close and original title should be restored.
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(0)
  // Title should be unchanged (Escape should revert).
  await expect(page.getByTestId('note-row').first()).toContainText(originalTitle!.trim())
})

test('PARITY GAP: double-click opens pinned tab, does NOT trigger rename', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // Double-click the note row.
  await page.getByTestId('note-row').first().dblclick()

  // Obsidian would open an inline rename input. Noteser opens a pinned tab.
  // Assert that no inline input appeared (confirming the parity gap).
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(0)

  // And confirm the editor opened with a pinned tab (non-preview).
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
  const tabTitle = page.locator('[class*="italic"]').first()
  // A preview tab would be italic; a pinned tab is not italic.
  // Check by store state — isPreview should be false after double-click.
  const isPreview = await page.evaluate(() => {
    const ws = window.__noteser_test?.stores.workspaceStore?.getState()
    if (!ws) return null
    const pane = ws.panes[0]
    if (!pane) return null
    const activeTab = pane.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (activeTab as { isPreview?: boolean })?.isPreview ?? null
  })
  // After double-click the tab should NOT be a preview tab.
  expect(isPreview).toBe(false)
})
