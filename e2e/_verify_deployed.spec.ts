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

  // Seed one group containing Files + a folder we can right-click.
  await page.evaluate(() => {
    const s = window.__noteser_test!.stores.settingsStore.getState()
    s.setSidebarGroups([{ id: 'verify-g', tabs: ['files'], activeTab: 'files', collapsed: false }])
    const fs = window.__noteser_test!.stores.folderStore.getState()
    fs.ensureFolderPath(['Verify folder'])
  })
  await page.waitForTimeout(400)

  const before = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().sidebarGroups,
  )
  expect(before[0]?.tabs).toEqual(['files'])

  // Right-click the folder row inside the panel.
  await page.getByTestId('folder-row').first().click({ button: 'right' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'fix1-right-click-context-menu.png'), fullPage: false })

  // Context menu visible (Rename is a stable label across versions).
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()

  // Panel still in the same group (the bug used to bubble-unpin).
  const after = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().sidebarGroups,
  )
  expect(after[0]?.tabs).toEqual(['files'])
})

test('FIX 2: intra-strip reorder round-trips through the store', async ({ page }) => {
  await page.goto(PROD)
  await page.waitForFunction(() => !!window.__noteser_test)

  // One group with three tabs.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState()
      .setSidebarGroups([{ id: 'verify-r', tabs: ['files', 'outline', 'search'], activeTab: 'files', collapsed: false }])
  })
  await page.waitForTimeout(400)

  await expect(page.getByTestId('sidebar-pinned-tab-files')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-outline')).toBeVisible()
  await expect(page.getByTestId('sidebar-pinned-tab-search')).toBeVisible()
  await page.screenshot({ path: path.join(OUT, 'fix2-strip-before.png'), fullPage: false })

  // Drive a reorder through the store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState()
      .setSidebarGroups([{ id: 'verify-r', tabs: ['search', 'files', 'outline'], activeTab: 'search', collapsed: false }])
  })
  await page.waitForTimeout(400)

  const after = await page.evaluate(() =>
    window.__noteser_test!.stores.settingsStore.getState().sidebarGroups,
  )
  expect(after[0]?.tabs).toEqual(['search', 'files', 'outline'])
  await page.screenshot({ path: path.join(OUT, 'fix2-strip-after.png'), fullPage: false })

  await expect(page.getByTestId('sidebar-pinned-tab-files')).toHaveAttribute('draggable', 'true')
})
