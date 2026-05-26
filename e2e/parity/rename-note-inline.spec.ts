import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: rename-note-inline
//
// Obsidian behavior: double-click a note title in the sidebar → the
// title becomes an editable text input in place. Enter commits,
// Escape cancels.
//
// Noteser today: rename is reachable via right-click → Rename AND the
// F2 key on the focused tree row — both land in the same inline-edit
// flow via useUIStore.requestRename. Double-click now PINS the tab (VS
// Code style), so it no longer starts rename.
// (Was a parity gap until 2026-05-21.)

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('context-menu Rename makes the title editable and Enter commits', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Create a note.
  await page.getByTestId('ribbon-item-new-note').click()
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

  await page.getByTestId('ribbon-item-new-note').click()
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

test('F2 on the focused tree row triggers inline rename', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTestId('ribbon-item-new-note').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  // Focus the tree (drops the keyboard cursor on the first row), then F2.
  await page.getByTestId('folder-tree').focus()
  await page.keyboard.press('F2')
  await page.waitForTimeout(150)

  const rename = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().renameRequest,
  )
  expect(rename?.type).toBe('note')
  // And the EditableText component renders an <input> for the row.
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(1)
})

test('double-click does NOT trigger inline rename (it pins instead)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTestId('ribbon-item-new-note').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)

  await page.getByTestId('note-row').first().dblclick()
  await page.waitForTimeout(150)

  const rename = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().renameRequest,
  )
  expect(rename).toBeNull()
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(0)
})
