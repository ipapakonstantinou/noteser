import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: scrollable-pinned-area
//
// Obsidian behavior: with many pinned groups, the pinned area scrolls
// internally; the main tab strip stays reachable at the bottom.
//
// Noteser today: SidebarStack renders pinned groups inside a div with
// max-h-[60%] and overflow-y-auto so the area caps at 60% of the sidebar
// height and scrolls if needed. The tab strip is always below it.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('with many pinned groups the main tab strip stays reachable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pin all available sidebar panels to create many pinned groups.
  // The panel registry has: notes, search, bookmarks, tags, recent,
  // calendar, outline, backlinks, scm (and maybe more). Use the store
  // to set a pile of groups.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setPinnedPanels([
      ['search'],
      ['bookmarks'],
      ['tags'],
      ['recent'],
      ['calendar'],
    ])
  })

  // The main strip icon for 'files' should still be visible (not pushed
  // off-screen by the pinned area overflow). Panel id is 'files' per
  // sidebarPanelRegistry.tsx — not 'notes'.
  await expect(page.getByTestId('sidebar-tab-files')).toBeVisible()
  // The pin drop-zone is in the DOM but is h-0/transparent outside drag — just
  // assert it's attached (count=1) rather than visually visible.
  await expect(page.getByTestId('sidebar-pin-dropzone')).toHaveCount(1)
})

test('pinned area has overflow-y-auto (internal scroll container)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pin several groups.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setPinnedPanels([
      ['search'],
      ['bookmarks'],
      ['tags'],
    ])
  })

  // Find the scrollable pinned-area container. It should have max-height set
  // and overflow-y:auto. We identify it by checking for a scrollable ancestor
  // of the pinned tab icons.
  const pinnedTabEl = page.getByTestId('sidebar-pinned-tab-search')
  await expect(pinnedTabEl).toBeVisible()

  // Walk up the DOM tree to find the overflow container.
  const hasScrollContainer = await pinnedTabEl.evaluate((el) => {
    let cur = el.parentElement
    while (cur) {
      const style = getComputedStyle(cur)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return true
      cur = cur.parentElement
    }
    return false
  })
  expect(hasScrollContainer).toBe(true)
})
