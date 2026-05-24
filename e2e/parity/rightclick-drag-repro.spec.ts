import { test, expect } from '@playwright/test'
import { setupCleanVault, pinTabViaMenu, unpinTabViaMenu } from './_helpers'

// Bug-repro: right-clicking a sidebar icon should NOT trigger a drag.
//
// Since 2026-05-22 right-clicking a sidebar tab icon opens the
// TabContextMenu (Pin to top / Unpin / Hide) rather than instantly
// pinning. The drag-guard assertions below are unchanged — right-click
// must still never start a drag — but the "applies correct action"
// tests now drive the menu (via pinTabViaMenu / unpinTabViaMenu).
//
// User report: "when I right click on the icon is like drag and drop
// on top automatically". Suspected root cause: the draggable <div>
// wrapper in TabSwitcher.tsx has `onDragStart` and `draggable` at the
// DIV level, while the <button> inside handles clicks/right-clicks.
// When the user right-clicks the browser fires a mousedown (button=2)
// on the draggable outer div first — some browsers/platforms DO start
// a drag on button=2 because the `draggable` attribute has no
// button-guard.
//
// For PinnedMiniStrip the icon IS the draggable button itself
// (draggable on the <button>), so the same issue exists there.
//
// This spec checks that:
// 1. After a right-click on a bottom-strip icon the drag-active CSS
//    outline does NOT appear on the pinned strip (i.e. no drag
//    started and SidebarStack did not fire `dragstart`).
// 2. The context-menu behavior fires correctly (panel is pinned).
// 3. After a right-click on a pinned-strip icon the drag-active CSS
//    outline does NOT appear (no spurious drag).

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

// --- helpers ---
async function captureDragFlag(page: import('@playwright/test').Page): Promise<boolean> {
  // Inject a window-level dragstart listener that records if a drag fired.
  return page.evaluate(() => {
    return new Promise<boolean>(resolve => {
      let fired = false
      const handler = () => { fired = true }
      window.addEventListener('dragstart', handler, { once: true })
      // Give it 600ms — any drag that the right-click spawns will
      // fire well within that window.
      setTimeout(() => {
        window.removeEventListener('dragstart', handler)
        resolve(fired)
      }, 600)
    })
  })
}

// Simulate the real-browser gesture: mousedown (right button) on the
// element, then mouse-move several pixels (which in browsers with a
// `draggable` element can initiate a drag). This is the sequence the
// user's browser sends when they right-click-and-hold.
async function rightClickHoldAndMove(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<boolean> {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`Element not found: ${selector}`)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // Set up drag listener before any pointer events.
  const dragFiredPromise = captureDragFlag(page)

  // Dispatch native pointer events: right-mousedown, then move.
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  // Move enough to exceed the browser's drag-initiation threshold (usually 4px).
  await page.mouse.move(cx + 10, cy + 10)
  await page.mouse.move(cx + 20, cy + 20)
  // Release.
  await page.mouse.up({ button: 'right' })

  return dragFiredPromise
}

test('right-click on bottom-strip icon does not start a drag (click)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  const icon = page.getByTestId('sidebar-tab-bookmarks')
  await expect(icon).toBeVisible()

  const dragFiredPromise = captureDragFlag(page)
  await icon.click({ button: 'right' })
  const dragFired = await dragFiredPromise

  await page.screenshot({ path: 'playwright-report/notes/rightclick-strip-icon.png' })
  expect(dragFired, 'right-click click should not fire dragstart on bottom-strip icon').toBe(false)
})

test('right-click hold+move on bottom-strip icon does not start a drag', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()

  // Simulate right-mousedown + mousemove — the real trigger the user reports.
  const dragFired = await rightClickHoldAndMove(page, '[data-testid="sidebar-tab-bookmarks"]')

  await page.screenshot({ path: 'playwright-report/notes/rightclick-hold-strip-icon.png' })

  // Check that the InterGroupDropZone did NOT become visible (h-6) —
  // that would indicate SidebarStack saw a dragstart.
  const dropZone = page.getByTestId('sidebar-inter-group-dropzone').first()
  // If active the zone has h-6 (24px height). h-0 means no drag active.
  const zoneHeight = await dropZone.evaluate((el) => (el as HTMLElement).offsetHeight)

  if (dragFired || zoneHeight > 0) {
    await page.screenshot({ path: 'playwright-report/notes/rightclick-hold-DRAG-FIRED.png' })
  }

  expect(dragFired, 'right-click hold+move should NOT fire dragstart on bottom-strip icon').toBe(false)
  expect(zoneHeight, 'InterGroupDropZone should stay collapsed (0px) — not inflated by spurious drag').toBe(0)
})

test('right-click on bottom-strip icon applies correct action (pin)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()
  // Right-click opens the context menu; "Pin to top" pins the panel.
  await pinTabViaMenu(page, 'bookmarks')

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible({ timeout: 2000 })
})

test('right-click on pinned-strip icon does not start a drag (click)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await pinTabViaMenu(page, 'bookmarks')
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  const dragFiredPromise = captureDragFlag(page)
  await page.getByTestId('sidebar-pinned-tab-bookmarks').click({ button: 'right' })
  const dragFired = await dragFiredPromise

  await page.screenshot({ path: 'playwright-report/notes/rightclick-pinned-icon.png' })
  expect(dragFired, 'right-click click should not fire dragstart on pinned-strip icon').toBe(false)
})

test('right-click hold+move on pinned-strip icon does not start a drag', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Pin the bookmarks panel first.
  await pinTabViaMenu(page, 'bookmarks')
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  // Also pin a second panel so there is an inter-group drop zone to check.
  await pinTabViaMenu(page, 'search')
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()

  // Simulate right-mousedown + move on the pinned icon.
  const dragFired = await rightClickHoldAndMove(page, '[data-testid="sidebar-pinned-tab-bookmarks"]')

  await page.screenshot({ path: 'playwright-report/notes/rightclick-hold-pinned-icon.png' })

  const dropZone = page.getByTestId('sidebar-inter-group-dropzone').first()
  const zoneHeight = await dropZone.evaluate((el) => (el as HTMLElement).offsetHeight)

  if (dragFired || zoneHeight > 0) {
    await page.screenshot({ path: 'playwright-report/notes/rightclick-hold-pinned-DRAG-FIRED.png' })
  }

  expect(dragFired, 'right-click hold+move should NOT fire dragstart on pinned-strip icon').toBe(false)
  expect(zoneHeight, 'InterGroupDropZone should stay collapsed (0px)').toBe(0)
})

test('right-click on pinned-strip icon applies correct action (unpin)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Pin first.
  await pinTabViaMenu(page, 'bookmarks')
  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toBeVisible()

  // Now right-click the pinned icon → "Unpin" — should unpin.
  await unpinTabViaMenu(page, 'bookmarks')

  await expect(page.getByTestId('sidebar-pinned-tab-bookmarks')).toHaveCount(0)
  await expect(page.getByTestId('sidebar-tab-bookmarks')).toBeVisible()
})
