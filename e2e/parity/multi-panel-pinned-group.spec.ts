import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

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

  // Pin two different panels via right-click.
  await page.getByTestId('sidebar-tab-bookmarks').click({ button: 'right' })
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  await page.getByTestId('sidebar-tab-search').click({ button: 'right' })
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Both should be visible and in pinned state.
  const pinnedPanels = await page.evaluate(() => {
    return window.__noteser_test!.stores.settingsStore.getState().pinnedPanels
  })
  // Each right-click creates its own group: [[bookmarks], [search]]
  expect(pinnedPanels.length).toBe(2)
  expect(pinnedPanels[0]).toContain('bookmarks')
  expect(pinnedPanels[1]).toContain('search')
})

test('setting pinnedPanels with two ids in one group renders them in the same mini-strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Directly set a multi-icon group via store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setPinnedPanels([
      ['bookmarks', 'search'],
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
    window.__noteser_test!.stores.settingsStore.getState().setPinnedPanels([
      ['bookmarks', 'search'],
    ])
  })

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Right-click pinned-bookmarks to unpin it.
  await page.getByTestId('sidebar-pinned-tab-bookmarks').click({ button: 'right' })

  // Bookmarks should be back in the main strip.
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()

  // Search should remain pinned.
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
})
