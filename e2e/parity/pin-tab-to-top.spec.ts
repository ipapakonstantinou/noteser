import { test, expect } from '@playwright/test'
import { setupCleanVault, pinTabViaMenu, unpinTabViaMenu } from './_helpers'

// Obsidian-parity scenario: pin-tab-to-top
//
// Obsidian behavior: right-clicking an icon in the bottom sidebar tab
// strip offers "pin to top" which moves the panel into its own
// pinned mini-strip above. Dragging the icon to the top drop-zone
// achieves the same thing.
//
// Noteser today: TabSwitcher icon buttons live under
// `[data-testid="sidebar-tab-<id>"]`. Right-click on one opens the
// TabContextMenu (since 2026-05-22) — choosing "Pin to top" causes a
// PinnedMiniStrip to mount above the main strip with
// `[data-testid="sidebar-pinned-tab-<id>"]`. The scenario asserts the
// round-trip: pin → pinned-tab appears + main-strip loses that id; unpin
// (right-click pinned tab → "Unpin") → strip rejoins.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('right-click on a strip icon pins it to a top mini-strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // The main tab strip has several known ids — bookmarks is reliably
  // present in the default panel registry. Right-click → "Pin to top".
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()
  await pinTabViaMenu(page, 'bookmarks')

  // After pinning the icon should appear in a top mini-strip AND
  // disappear from the bottom strip.
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toHaveCount(0)
})

test('right-click on a pinned mini-strip icon unpins it back into the strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Pin first.
  await pinTabViaMenu(page, 'bookmarks')
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  // Unpin via right-click → "Unpin" on the pinned tab.
  await unpinTabViaMenu(page, 'bookmarks')

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()
})

test('pinning multiple panels creates multiple mini-strips', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await pinTabViaMenu(page, 'bookmarks')
  await pinTabViaMenu(page, 'search')

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
})
