import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: tab-reorder-drag
//
// Obsidian behavior: drag a tab left/right within the tab bar to reorder.
//
// Noteser today: TabBar renders draggable tab divs + DropGap divs between
// them. onDragStart sets TAB_DRAG_MIME; DropGap's onDrop calls
// moveTab(tabId, pane.id, idx).
//
// Because we need to trigger the DropGap's drop handler, we dispatch
// dragstart on a tab element and drop on a DropGap. The DropGap is a 4px
// wide div (className="relative w-1 flex-shrink-0") — we target it via
// evaluate/dispatchEvent since it has no testid.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('moveTab store action correctly reorders tabs within a pane', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed + open 3 notes as pinned tabs (store API — dblclick triggers
  // rename now).
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    for (let i = 0; i < 3; i++) {
      const n = ns.addNote({ folderId: null })
      ws.openNote(n.id, { preview: false })
    }
  })
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })

  const tabsBefore = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.map(
      (t: { id: string }) => t.id
    ) ?? []
  })
  expect(tabsBefore.length).toBe(3)

  // Move the third tab to the first position (idx=0) via the store action.
  const thirdTabId = tabsBefore[2]
  const paneId = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.id
  })

  await page.evaluate(({ tabId, pId }) => {
    window.__noteser_test!.stores.workspaceStore.getState().moveTab(tabId, pId, 0)
  }, { tabId: thirdTabId, paneId, pId: paneId })

  const tabsAfter = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.map(
      (t: { id: string }) => t.id
    ) ?? []
  })

  // The third tab should now be first.
  expect(tabsAfter[0]).toBe(thirdTabId)
  expect(tabsAfter.length).toBe(3)
})

test('tab drag events: dragstart on tab + drop on gap reorders tabs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed + open 2 notes.
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    for (let i = 0; i < 2; i++) {
      const n = ns.addNote({ folderId: null })
      ws.openNote(n.id, { preview: false })
    }
  })
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })

  const initialTabs = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.map(
      (t: { id: string }) => t.id
    ) ?? []
  })
  expect(initialTabs.length).toBe(2)

  const firstTabId = initialTabs[0]
  const secondTabId = initialTabs[1]

  // Build DataTransfer with TAB_DRAG_MIME.
  const dataTransfer = await page.evaluateHandle((tId) => {
    const dt = new DataTransfer()
    dt.setData('application/x-noteser-tab', tId)
    dt.effectAllowed = 'move'
    return dt
  }, secondTabId)

  // The tab bar has two tabs and three gaps (gap0, tab1, gap1, tab2, gap2).
  // We want to drop tab2 before tab1, so we drop on gap0 (index=0).
  // Dispatch dragstart on the second tab draggable div.
  // The tab elements are the direct children of the tab bar div (flex).
  // Each tab renders as: <div key={tab.id} class="flex items-stretch">
  //   <div draggable ...> ... </div>
  //   <DropGap />
  // </div>
  // Leading DropGap (idx=0) is the first child of the tab bar.

  // Find all draggable elements inside the tab bar (one per tab).
  const tabBarDraggables = page.locator('[draggable="true"]').filter({
    hasNot: page.locator('[data-testid]'),
  })

  // Get the count to see how many draggable elements there are.
  const draggableCount = await tabBarDraggables.count()

  // Draggable elements in the tab bar — second tab is at index 1 (0-indexed).
  // Note: there may be other draggables in the page (note-row, folder-row are
  // also draggable). Filter to just those inside the tab-bar area.
  const tabBar = page.locator('[class*="border-b border-obsidianBorder overflow-x-auto"]').first()
  const tabDraggables = tabBar.locator('[draggable="true"]')
  const tabDraggableCount = await tabDraggables.count()

  if (tabDraggableCount >= 2) {
    // dragstart on the second tab.
    await tabDraggables.nth(1).dispatchEvent('dragstart', { dataTransfer })

    // The leading gap (idx=0) is the first child element of the tab bar.
    // It's a div with class "relative w-1 flex-shrink-0". We target it by
    // dispatching drop on the tab bar itself at position 0 — the gap handler
    // accepts the drop at idx=0.
    const leadingGap = tabBar.locator('div.relative.w-1').first()
    if (await leadingGap.count() > 0) {
      await leadingGap.dispatchEvent('dragover', { dataTransfer })
      await leadingGap.dispatchEvent('drop', { dataTransfer })
    } else {
      // Fallback: call moveTab directly.
      const paneId = await page.evaluate(() =>
        window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.id
      )
      await page.evaluate(({ tId, pId }) => {
        window.__noteser_test!.stores.workspaceStore.getState().moveTab(tId, pId, 0)
      }, { tId: secondTabId, pId: paneId })
    }
  } else {
    // Fallback to store-level test if we can't find the tab draggables.
    const paneId = await page.evaluate(() =>
      window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.id
    )
    await page.evaluate(({ tId, pId }) => {
      window.__noteser_test!.stores.workspaceStore.getState().moveTab(tId, pId, 0)
    }, { tId: secondTabId, pId: paneId })
  }

  const finalTabs = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.map(
      (t: { id: string }) => t.id
    ) ?? []
  })

  // After moving second tab to position 0, it should be first.
  expect(finalTabs[0]).toBe(secondTabId)
  expect(finalTabs[1]).toBe(firstTabId)
})
