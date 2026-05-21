// Mobile parity: keyboard-safe heights.
//
// The root layout uses `h-dvh` (dynamic viewport height) so the iOS / Android
// soft keyboard shrinks the available area rather than covering the footer.
// Modals use `max-h-[Xdvh]` so they don't get pushed offscreen when typing.
//
// Asserts at iPhone SE size (375×667):
//   1. No horizontal scroll.
//   2. Root container fills the viewport vertically.
//   3. Settings modal is clamped to <= 90% of viewport height.

import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

test.use({ viewport: { width: 375, height: 667 } })

test('mobile root height uses dvh (no overflow, fits viewport)', async ({ page }) => {
  await setupCleanVault(page)
  await page.goto('/')
  await waitForTestHooks(page)

  // Body should not horizontally scroll at 375px.
  const overflowX = await page.evaluate(() => {
    const html = document.documentElement
    return html.scrollWidth - html.clientWidth
  })
  expect(overflowX).toBeLessThanOrEqual(1)

  // Root container has `h-dvh` — find it directly so we don't collide with
  // Next.js dev-overlay portal that also lives under <body>.
  const rootHeight = await page.evaluate(() => {
    const root = document.querySelector('.h-dvh') as HTMLElement | null
    return root ? root.getBoundingClientRect().height : 0
  })
  expect(rootHeight).toBeGreaterThan(600)
  expect(rootHeight).toBeLessThanOrEqual(667)

})

test('settings modal clamps to viewport at mobile size', async ({ page }) => {
  await setupCleanVault(page)
  await page.goto('/')
  await waitForTestHooks(page)

  // Open settings via the store hook so we don't fight the Next.js dev
  // overlay for pointer events.
  await page.evaluate(() => {
    window.__noteser_test?.stores.uiStore.getState().openModal({ type: 'settings' })
  })

  const modal = page.locator('[role="dialog"]')
  await expect(modal).toBeVisible()

  const modalHeight = await modal.evaluate((el) => el.getBoundingClientRect().height)
  // 90dvh of 667 = 600.3 — allow a 1px rounding cushion.
  expect(modalHeight).toBeLessThanOrEqual(601)
})
