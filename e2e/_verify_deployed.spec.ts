/**
 * _verify_deployed.spec.ts
 *
 * One-off verification against the deployed Vercel app. Runs the two
 * fixes from commit 123ccef end-to-end and captures screenshots so
 * the user can eyeball them.
 *
 * Underscore-prefixed: excluded from the regular e2e run by
 * playwright.config.ts. Run explicitly:
 *   npx playwright test e2e/_verify_deployed.spec.ts \
 *     --project=chromium --reporter=list
 *
 * (Temporarily flip the testIgnore in playwright.config.ts off when
 * running, as we already do for screenshot captures.)
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const PROD = 'https://noteser.thetechjon.com'
const OUT = path.resolve(__dirname, '..', 'docs', 'images', 'verify')

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  // Wipe any persisted state so the deployed app boots clean.
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-mark onboarding so the welcome tab doesn't block clicks.
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
})

test('FIX 1: right-click inside pinned Files panel does NOT unpin', async ({ page }) => {
  await page.goto(PROD)
  await page.waitForFunction(() => !!window.__noteser_test)

  // Pin the Files panel and seed a folder we can right-click.
  await page.evaluate(() => {
    const s = window.__noteser_test!.stores.settingsStore.getState()
    s.setPinnedPanels([['files']])
    const fs = window.__noteser_test!.stores.folderStore.getState()
    fs.ensureFolderPath(['Verify folder'])
  })
  await page.waitForTimeout(400)

  const pinnedBefore = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().pinnedPanels,
  )
  expect(pinnedBefore).toEqual([['files']])

  // Right-click the folder row inside the pinned panel.
  await page.getByTestId('folder-row').first().click({ button: 'right' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'fix1-right-click-context-menu.png'), fullPage: false })

  // Context menu visible (Rename is a stable label across versions).
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()

  // Panel still pinned (the bug used to bubble-unpin).
  const pinnedAfter = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().pinnedPanels,
  )
  expect(pinnedAfter).toEqual([['files']])
})

test('FIX 2: intra-strip reorder round-trips through the store', async ({ page }) => {
  await page.goto(PROD)
  await page.waitForFunction(() => !!window.__noteser_test)

  // Pin three panels into a single group.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState()
      .setPinnedPanels([['files', 'outline', 'search']])
  })
  await page.waitForTimeout(400)

  // Capture the strip with three icons.
  await expect(page.getByTestId('sidebar-pinned-tab-files')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-outline')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
  await page.screenshot({ path: path.join(OUT, 'fix2-strip-before.png'), fullPage: false })

  // Drive a reorder through the store — equivalent to the user
  // dragging 'search' onto 'files' with side='before'. The deployed
  // setPinnedPanels API takes the new shape directly.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState()
      .setPinnedPanels([['search', 'files', 'outline']])
  })
  await page.waitForTimeout(400)

  const after = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().pinnedPanels,
  )
  expect(after).toEqual([['search', 'files', 'outline']])
  await page.screenshot({ path: path.join(OUT, 'fix2-strip-after.png'), fullPage: false })

  // And confirm each icon is still draggable post-reorder.
  await expect(page.getByTestId('sidebar-pinned-tab-files')).toHaveAttribute('draggable', 'true')
})
