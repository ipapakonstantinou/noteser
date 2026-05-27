import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Verifies the quiet "Report an issue on GitHub" links added to the Settings
// → About panel and the Keyboard Shortcuts modal. Each must point at the
// noteser new-issue URL and open in a new tab.

const ISSUE_URL = 'https://github.com/ipapakonstantinou/noteser/issues/new'

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('Settings → About has a Report-an-issue link to the new-issue URL, opens in a new tab', async ({ page }) => {
  await page.goto('/')
  await waitForTestHooks(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await page.getByTestId('settings-cat-about').click()

  const link = page.getByTestId('settings-report-issue-link')
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', ISSUE_URL)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noreferrer')
})

test('Shortcuts modal has a Report-an-issue link to the new-issue URL, opens in a new tab', async ({ page }) => {
  await page.goto('/')
  await waitForTestHooks(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'shortcuts' })
  })

  const link = page.getByTestId('shortcuts-report-issue-link')
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', ISSUE_URL)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noreferrer')
})
