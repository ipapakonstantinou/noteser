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

  // Pin a pile of sidebar panels to create many pinned groups. Use real
  // panel ids from sidebarPanelRegistry.tsx (calendar, files, outline,
  // source-control, search, bookmarks, related) — the old 'tags'/'recent'
  // ids were dropped in the May-2026 ribbon redesign.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setSidebarGroups([
      { id: 'sc-1', tabs: ['search'],    activeTab: 'search',    collapsed: false },
      { id: 'sc-2', tabs: ['bookmarks'], activeTab: 'bookmarks', collapsed: false },
      { id: 'sc-3', tabs: ['outline'],   activeTab: 'outline',   collapsed: false },
      { id: 'sc-4', tabs: ['related'],   activeTab: 'related',   collapsed: false },
      { id: 'sc-5', tabs: ['calendar'],  activeTab: 'calendar',  collapsed: false },
    ])
  })

  // The main strip icon for 'files' should still be visible (not pushed
  // off-screen by the pinned area overflow). Panel id is 'files' per
  // sidebarPanelRegistry.tsx — not 'notes'.
  await expect(page.getByTestId('sidebar-tab-files')).toBeVisible()
  // The pinned groups render above the main strip. (The visible "pin to
  // top" drop-zone was removed in 2026-05 — pinning is now via right-click
  // → "Pin to top" — so there is no longer a sidebar-pin-dropzone element.)
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
})

test('pinned area has overflow-y-auto (internal scroll container)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pin several groups.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setSidebarGroups([
      { id: 'sc-a', tabs: ['search'],    activeTab: 'search',    collapsed: false },
      { id: 'sc-b', tabs: ['bookmarks'], activeTab: 'bookmarks', collapsed: false },
      { id: 'sc-c', tabs: ['outline'],   activeTab: 'outline',   collapsed: false },
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
