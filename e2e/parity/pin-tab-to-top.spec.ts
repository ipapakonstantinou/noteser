import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: pin-tab-to-top
//
// Obsidian behavior: right-clicking an icon in the bottom sidebar tab
// strip offers "pin to top" which moves the panel into its own
// pinned mini-strip above. Dragging the icon to the top drop-zone
// achieves the same thing.
//
// Noteser today: TabSwitcher icon buttons live under
// `[data-testid="sidebar-tab-<id>"]`. Right-click on one calls
// `onPinPanel(id)`, which causes a PinnedMiniStrip to mount above the
// main strip with `[data-testid="sidebar-pinned-tab-<id>"]`. The
// scenario asserts the round-trip: pin → pinned-tab appears + main-strip
// loses that id; unpin (right-click pinned tab) → strip rejoins.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('right-click on a strip icon pins it to a top mini-strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // The main tab strip has several known ids — bookmarks is reliably
  // present in the default panel registry. Right-click pins.
  const stripBookmark = page.getByTestId('sidebar-tab-bookmarks')
  await expect(stripBookmark).toBeVisible()
  await stripBookmark.click({ button: 'right' })

  // After pinning the icon should appear in a top mini-strip AND
  // disappear from the bottom strip.
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toHaveCount(0)
})

test('right-click on a pinned mini-strip icon unpins it back into the strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Pin first.
  await page.getByTestId('sidebar-tab-bookmarks').click({ button: 'right' })
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  // Unpin via right-click on the pinned tab.
  await page.getByTestId('sidebar-pinned-tab-bookmarks').click({ button: 'right' })

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()
})

test('pinning multiple panels creates multiple mini-strips', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('sidebar-tab-bookmarks').click({ button: 'right' })
  await page.getByTestId('sidebar-tab-search').click({ button: 'right' })

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
})
