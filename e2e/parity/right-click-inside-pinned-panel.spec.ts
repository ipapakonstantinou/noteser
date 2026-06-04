import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Regression: right-click inside a pinned panel should open the
// panel's local context menu (e.g. the folder right-click menu) and
// NOT bubble up to the surrounding pinned-group, which would
// otherwise unpin the panel back to the bottom strip.
//
// Reported via Telegram 2026-05-21. Root cause: PinnedGroup forwarded
// `onHeaderContextMenu` to SidebarSection which, with hideHeader=true,
// attached the handler to the content wrapper. Any descendant right-
// click bubbled into it. Fixed by dropping that prop + adding
// stopPropagation defensively in Sidebar.handleRightClick.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('right-clicking a folder inside a pinned Files panel does NOT unpin the panel', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pin the Files panel into its own group at the top, and seed a
  // folder we can right-click on.
  const folderId = await page.evaluate(() => {
    const s = window.__noteser_test!.stores.settingsStore.getState()
    s.setSidebarGroups([{ id: 'rc-g', tabs: ['files'], activeTab: 'files', collapsed: false }])
    const fs = window.__noteser_test!.stores.folderStore.getState()
    return fs.ensureFolderPath(['Right-click target'])
  })
  expect(folderId).toBeTruthy()
  await page.waitForTimeout(200)

  // Confirm files lives in one group.
  const before = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().sidebarGroups,
  )
  expect(before[0]?.tabs).toEqual(['files'])

  // Right-click the folder row inside the pinned panel.
  await page.getByTestId('folder-row').first().click({ button: 'right' })
  await page.waitForTimeout(200)

  // 1. The folder context menu appears (with at least the Rename option).
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()

  // 2. The Files panel STAYS in its group — it did not bubble-close.
  const after = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().sidebarGroups,
  )
  expect(after[0]?.tabs).toEqual(['files'])
})
