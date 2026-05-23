import { test, expect } from '@playwright/test'

// Mobile edge-swipe to open/close the sidebar drawer.
//
// Uses a mobile-sized viewport (iPhone 13 dimensions: 390x844) with
// touch emulation. The swipe logic lives in src/utils/edgeSwipe.ts
// (pure) and is wired in src/app/page.tsx via a touchstart/touchend
// listener gated on `mobileLayout`.
//
// Note: we set the viewport at the project level here to avoid
// "Cannot use({ defaultBrowserType }) in a describe group" errors.
// Two separate files: this one for mobile, and the desktop check
// is an additional describe with viewport override.

// Helper: synthesize a swipe via touchstart + touchend events.
// We dispatch directly to bypass Playwright's touch device requirements.
async function dispatchSwipe(
  page: import('@playwright/test').Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  await page.evaluate(
    ({ fromX, fromY, toX, toY }) => {
      const makeTouch = (x: number, y: number, id = 0) =>
        new Touch({
          identifier: id, target: document.body,
          clientX: x, clientY: y, screenX: x, screenY: y,
          pageX: x, pageY: y,
          radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
        })

      const startTouch = makeTouch(fromX, fromY)
      window.dispatchEvent(new TouchEvent('touchstart', {
        touches: [startTouch], changedTouches: [startTouch],
        bubbles: true, cancelable: true,
      }))

      const endTouch = makeTouch(toX, toY)
      window.dispatchEvent(new TouchEvent('touchend', {
        touches: [], changedTouches: [endTouch],
        bubbles: true, cancelable: true,
      }))
    },
    { fromX, fromY, toX, toY },
  )
}

// Clear state before each test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch {}
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch {}
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch {}
  })
})

// ── Mobile viewport tests ─────────────────────────────────────────────────────
// iPhone 13 physical resolution: 390x844. Use this explicitly instead of
// the devices preset to avoid the "defaultBrowserType" describe-group error.

test.describe('mobile swipe drawer', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('right-swipe from left edge opens the drawer', async ({ page }) => {
    await page.goto('/')
    // MobileTopBar is the mobile-only indicator that the layout has switched.
    await expect(page.getByTestId('mobile-top-bar')).toBeVisible({ timeout: 10000 })

    const drawer = page.getByTestId('mobile-sidebar-drawer')
    // Drawer starts closed (translate-x-full applied).
    await expect(drawer).toHaveClass(/-translate-x-full/, { timeout: 5000 })

    // Swipe: start at x=10 (within the 24px edge window), end at x=80 (70px right).
    await dispatchSwipe(page, 10, 422, 80, 422)

    // Drawer should open.
    await expect(drawer).not.toHaveClass(/-translate-x-full/, { timeout: 3000 })
    await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeVisible({ timeout: 3000 })
  })

  test('left-swipe while drawer open closes it', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('mobile-top-bar')).toBeVisible({ timeout: 10000 })

    // Open the drawer first via swipe.
    await dispatchSwipe(page, 10, 422, 80, 422)

    const drawer = page.getByTestId('mobile-sidebar-drawer')
    await expect(drawer).not.toHaveClass(/-translate-x-full/, { timeout: 3000 })

    // Now left-swipe 70px — should close drawer.
    await dispatchSwipe(page, 150, 422, 80, 422)

    await expect(drawer).toHaveClass(/-translate-x-full/, { timeout: 3000 })
    await expect(page.getByTestId('mobile-sidebar-backdrop')).not.toBeVisible({ timeout: 3000 })
  })

  test('short swipe (<50px) does not open the drawer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('mobile-top-bar')).toBeVisible({ timeout: 10000 })

    const drawer = page.getByTestId('mobile-sidebar-drawer')

    // Only 30px — under the 50px threshold.
    await dispatchSwipe(page, 10, 422, 40, 422)

    // Give a moment for any erroneous state change to occur.
    await page.waitForTimeout(400)
    await expect(drawer).toHaveClass(/-translate-x-full/)
  })

  test('vertical scroll gesture does not toggle the drawer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('mobile-top-bar')).toBeVisible({ timeout: 10000 })

    const drawer = page.getByTestId('mobile-sidebar-drawer')

    // Small horizontal (20px) + large vertical (120px) — dy/dx = 6, > 0.6 ratio, should be ignored.
    await dispatchSwipe(page, 10, 200, 30, 320)

    await page.waitForTimeout(400)
    await expect(drawer).toHaveClass(/-translate-x-full/)
  })
})

// ── Desktop viewport test ─────────────────────────────────────────────────────

test.describe('desktop: swipe does not toggle anything', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('desktop: synthetic swipe from left edge does NOT create a mobile drawer', async ({
    page,
  }) => {
    await page.goto('/')
    // Wait for hydration on desktop (folder-tree).
    await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 10000 })

    // Desktop sidebar is controlled by the collapse toggle, not a drawer.
    // The mobile-sidebar-drawer element does not exist on desktop.
    expect(await page.getByTestId('mobile-sidebar-drawer').count()).toBe(0)

    // Dispatching a swipe should have zero effect (mobileLayout gate).
    await dispatchSwipe(page, 10, 400, 100, 400)
    await page.waitForTimeout(400)

    // Still no drawer.
    expect(await page.getByTestId('mobile-sidebar-drawer').count()).toBe(0)
  })
})
