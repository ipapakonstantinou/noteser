import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks, pinTabViaMenu, unpinTabViaMenu } from './_helpers'

// Obsidian-parity scenario: multi-panel-pinned-group
//
// Obsidian behavior: dragging an icon onto an existing pinned mini-strip
// adds it to that group (the strip becomes multi-icon).
//
// Noteser today: pinnedPanels is string[][] in settingsStore. Each inner
// array is a group shown as a PinnedMiniStrip. Pinning a second panel
// creates a second group (each right-click creates its own group). The
// "drag into existing group" behavior is tested via the store's setPinnedPanels.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('right-clicking two different icons creates two separate pinned mini-strips', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pin two different panels via right-click → "Pin to top".
  await pinTabViaMenu(page, 'bookmarks')
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  await pinTabViaMenu(page, 'search')
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Both should be visible and in pinned state.
  const sidebarGroups = await page.evaluate(() => {
    return window.__noteser_test!.stores.settingsStore.getState().sidebarGroups
  })
  // Each right-click creates its own group: bookmarks then search.
  expect(sidebarGroups.length).toBeGreaterThanOrEqual(2)
  expect(sidebarGroups.flatMap(g => g.tabs)).toEqual(expect.arrayContaining(['bookmarks', 'search']))
})

test('setting pinnedPanels with two ids in one group renders them in the same mini-strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Directly set a multi-icon group via store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setSidebarGroups([
      { id: 'multi-g', tabs: ['bookmarks', 'search'], activeTab: 'bookmarks', collapsed: false },
    ])
  })

  // Both icons should appear in pinned state.
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Neither should be in the main strip any more.
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-search')).toHaveCount(0)
})

test('unpinning one from a multi-icon group leaves the other still pinned', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a two-icon group.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setSidebarGroups([
      { id: 'multi-u', tabs: ['bookmarks', 'search'], activeTab: 'bookmarks', collapsed: false },
    ])
  })

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Right-click pinned-bookmarks → "Unpin".
  await unpinTabViaMenu(page, 'bookmarks')

  // Bookmarks should be back in the main strip.
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()

  // Search should remain pinned.
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
})
