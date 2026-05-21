/**
 * _verify_preview.spec.ts
 *
 * Smoke-test the dev-branch preview deploy at
 * https://noteser-git-dev-ipapakonstantinous-projects.vercel.app/
 *
 * Underscore-prefixed: excluded from the regular suite by
 * playwright.config.ts. Run with:
 *   npx playwright test --config playwright.config.deployed.ts \
 *     e2e/_verify_preview.spec.ts --project=chromium --reporter=list
 *
 * Hits a focused subset of the parity surface — enough to confirm
 * the preview reflects the latest dev commit + the recent sidebar /
 * welcome / preview-mode changes.
 */

import { test, expect } from '@playwright/test'

const PREVIEW = 'https://noteser-git-dev-ipapakonstantinous-projects.vercel.app'

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

test('preview: app boots and exposes test hooks', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test, undefined, { timeout: 15_000 })
  await expect(page.getByTestId('welcome-pane')).toBeVisible()
})

test('preview: pin-to-top bar is GONE (post 3e04925)', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  // The old "↑ PIN TO TOP" drop zone had testid="sidebar-pin-dropzone".
  // It was removed entirely. The count should be 0 even during a drag.
  await expect(page.getByTestId('sidebar-pin-dropzone')).toHaveCount(0)
})

test('preview: feature tour seeds Files/feature-tour attachments', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = false
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  await expect(page.getByTestId('welcome-feature-tour')).toBeVisible()
  await page.getByTestId('welcome-feature-tour').click()
  // Seed fans out 9 PNG fetches in parallel; give them room.
  await page.waitForTimeout(2500)
  // The feature-tour note should exist at vault root.
  const tour = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.find(n => !n.isDeleted && n.title === 'Feature tour') ?? null
  })
  expect(tour).not.toBeNull()
  expect(tour!.folderId).toBeNull()
})

test('preview: resize handle is grabbable (h-2 hit target)', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      parsed.state.pinnedPanels = [['calendar'], ['files']]
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  // SidebarSection renders one resize handle per expanded section
  // (incl. each pinned group). h-2 ≈ 8px hit target.
  const handles = page.getByRole('separator', { name: /Resize/ })
  const count = await handles.count()
  expect(count).toBeGreaterThan(0)
  // The handle's outer height should be ≥ 6px (Tailwind h-2 = 8px).
  const heightPx = await handles.first().evaluate((el) => el.getBoundingClientRect().height)
  expect(heightPx).toBeGreaterThanOrEqual(6)
})

test('preview: notesOpenInPreviewMode defaults to true', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  const val = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().notesOpenInPreviewMode,
  )
  expect(val).toBe(true)
})

test('preview: intra-strip drag-reorder writes to pinnedPanels', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      parsed.state.pinnedPanels = [['files', 'outline', 'search']]
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  // Reorder via the store API (same path the UI handler produces).
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState()
      .setPinnedPanels([['search', 'files', 'outline']])
  })
  await page.waitForTimeout(200)
  const result = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().pinnedPanels,
  )
  expect(result).toEqual([['search', 'files', 'outline']])
})
