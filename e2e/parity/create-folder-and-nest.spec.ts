import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: create-folder-and-nest
//
// Obsidian behavior: new folder via context-menu; can be nested arbitrarily;
// expanded/collapsed state survives reload.
//
// Noteser today: folders are created via the toolbar (+folder icon) or
// Ctrl+Shift+N. Expanded state lives in useFolderStore.expandedFolders and
// persists to localStorage (noteser-folders v2).

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('toolbar folder button creates a new folder in the sidebar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Click the "new folder" toolbar button.
  await page.getByTitle('New folder (Ctrl+Shift+N)').click()

  // A folder row should appear.
  await expect(page.getByTestId('folder-row')).toHaveCount(1)
})

test('Ctrl+Shift+N shortcut creates a new folder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('folder-tree').click()
  await page.keyboard.press('Control+Shift+n')

  await expect(page.getByTestId('folder-row')).toHaveCount(1)
})

test('nested folder: store reflects parentId relationship', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Create parent + child via store API for reliable seeding.
  // Note: addFolder() auto-expands each newly created folder, so both
  // parent and child are visible immediately after creation (2 rows).
  const { parentId, childId } = await page.evaluate(() => {
    const folderStore = window.__noteser_test!.stores.folderStore.getState()
    const parent = folderStore.addFolder({ parentId: null, name: 'Parent Folder' })
    const child = folderStore.addFolder({ parentId: parent.id, name: 'Child Folder' })
    return { parentId: parent.id, childId: child.id }
  })

  // addFolder auto-expands both folders, so both rows should already be visible.
  await expect(page.getByTestId('folder-row')).toHaveCount(2)

  // Verify nesting via store state.
  const childParent = await page.evaluate(
    ({ cId }) => {
      const folders = window.__noteser_test!.stores.folderStore.getState().folders
      return folders.find((f: { id: string }) => f.id === cId)?.parentId ?? null
    },
    { cId: childId },
  )
  expect(childParent).toBe(parentId)
})

test('expanded state is stored in expandedFolders record and toggle flips it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Create parent + child. addFolder auto-expands both — both rows visible.
  const { parentId } = await page.evaluate(() => {
    const folderStore = window.__noteser_test!.stores.folderStore.getState()
    const parent = folderStore.addFolder({ parentId: null, name: 'Persist Parent' })
    folderStore.addFolder({ parentId: parent.id, name: 'Nested Child' })
    return { parentId: parent.id }
  })

  // Both are expanded → 2 rows visible.
  await expect(page.getByTestId('folder-row')).toHaveCount(2)

  // Verify expand state in store.
  const expandedBefore = await page.evaluate(({ pId }) => {
    return window.__noteser_test!.stores.folderStore.getState().expandedFolders[pId]
  }, { pId: parentId })
  expect(expandedBefore).toBe(true)

  // Collapse the parent.
  await page.evaluate(({ pId }) => {
    window.__noteser_test!.stores.folderStore.getState().toggleFolderExpanded(pId)
  }, { pId: parentId })

  // After collapse, only 1 row (parent).
  await expect(page.getByTestId('folder-row')).toHaveCount(1)

  // Verify store reflects collapsed state.
  const expandedAfter = await page.evaluate(({ pId }) => {
    return window.__noteser_test!.stores.folderStore.getState().expandedFolders[pId]
  }, { pId: parentId })
  expect(expandedAfter).toBe(false)

  // Expand again by clicking the chevron button in the UI.
  await page.getByTestId('folder-row').first().locator('button').first().click()
  await expect(page.getByTestId('folder-row')).toHaveCount(2)
})
