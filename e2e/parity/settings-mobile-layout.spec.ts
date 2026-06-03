import { test, expect } from '@playwright/test'

// Settings modal on a mobile viewport. Caught from a real Jon-on-iPhone
// screenshot: the side-by-side layout broke (right pane squeezed to ~40%,
// content wrapped one word per line). v1.1 fix moved the category rail
// to a horizontal scroll strip on viewports below md (768px). Plus the
// Plugins + Beta categories used to share the BeakerIcon — Plugins gets
// the puzzle-piece icon now.

test('Settings modal lays out correctly on a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }) // iPhone 13 mini
  await page.goto('/')

  // Open Settings via the command palette so we do not depend on the
  // sidebar layout (which the screenshot showed was off-screen).
  await page.keyboard.press('Control+P')
  await page.getByPlaceholder('Type a command…').or(page.getByPlaceholder('Type a command...')).fill('Open Settings')
  await page.keyboard.press('Enter')

  // Wait for the modal to mount.
  await expect(page.getByTestId('settings-categories')).toBeVisible()

  // The category navigator on mobile should be a HORIZONTAL strip, not
  // a left rail squeezing the content. Measure its bounding box:
  // - On mobile its width should ~= viewport width
  // - Its height should be short (chip strip, not full-modal-height rail)
  const nav = await page.getByTestId('settings-categories').boundingBox()
  expect(nav).not.toBeNull()
  if (!nav) return
  expect(nav.width).toBeGreaterThan(300) // span the viewport
  expect(nav.height).toBeLessThan(100) // chips, not full-height rail

  // The active panel pane should have room to render readable text —
  // every text line should be wider than 200 px (was breaking to one
  // word per line in the bug).
  const panel = await page.getByTestId('settings-panel-general').boundingBox()
  expect(panel).not.toBeNull()
  if (!panel) return
  expect(panel.width).toBeGreaterThan(300)
})
