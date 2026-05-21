import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// "Show welcome tab" button in Settings → General. Lets users
// re-open the Welcome tab after dismissing it (the auto-open only
// fires when onboardingShown=false; this is the manual path).

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('Settings → General has a "Show welcome tab" button that opens the welcome tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Pre-mark onboarding so the welcome tab isn't already open.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setOnboardingShown(true)
  })
  // No welcome tab currently.
  await expect(page.getByTestId('welcome-pane')).toHaveCount(0)

  // Open Settings (via store API — the bottom-left cog can collide
  // with the Next.js dev indicator on localhost).
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })

  // General is the default category, but click it to be safe.
  await page.getByRole('button', { name: /^General$/ }).first().click()
  await page.waitForTimeout(150)

  // Click the button.
  await page.getByTestId('settings-show-welcome').click()
  await page.waitForTimeout(200)

  // Settings closes; welcome tab is visible.
  await expect(page.getByTestId('welcome-pane')).toBeVisible()
  // Settings modal is gone.
  const modalType = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().modal.type,
  )
  expect(modalType).toBeNull()
})
