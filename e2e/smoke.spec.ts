import { test, expect } from '@playwright/test'

// Sanity check: the app loads, the sidebar renders, the editor area is
// mounted. If this fails the rest of the suite has no chance.

test.beforeEach(async ({ page }) => {
  // Clean slate per test — clear localStorage/IDB before navigating so
  // persisted state from a previous run doesn't leak in.
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

test('app loads on / with the folder tree visible', async ({ page }) => {
  await page.goto('/')
  // The folder tree mounts after hydration. Wait for the tag-id selector.
  await expect(page.getByTestId('folder-tree')).toBeVisible()
})

test('title is the expected noteser branding', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Noteser/i)
})
