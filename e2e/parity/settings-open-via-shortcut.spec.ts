import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: settings-open-via-shortcut
//
// Obsidian behavior: Ctrl+, opens settings.
//
// Noteser today: Ctrl+, is NOT implemented as a keyboard shortcut.
// Settings can only be opened via:
//   1. Clicking the cog icon in the sidebar ribbon.
//   2. The command palette (Ctrl+Shift+P → "Open Settings").
//
// This spec verifies what IS implemented (command palette path), and
// flags the Ctrl+, gap.
//
// PARITY GAP: Ctrl+, does not open settings. Obsidian users expect this
// binding universally. The cog button is an acceptable workaround but
// muscle memory will fail.
//
// NOTE from sweep brief: the cog icon collides with Next.js dev indicator's
// pointer-capture portal. Use the store API to open settings instead.
//
// NOTE: the Modal component does NOT have role="dialog". Use testid assertions.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('store API: openModal({ type: "settings" }) opens the settings modal', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open settings via the store API (safe workaround for cog button).
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })

  // The settings categories sidebar should be present (confirms modal opened).
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
})

test('PARITY GAP: Ctrl+, does NOT open the settings modal', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Press Ctrl+, — this is what Obsidian users expect.
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(200)

  // The modal should NOT have opened.
  const modalState = await page.evaluate(() => {
    return window.__noteser_test!.stores.uiStore.getState().modal.type
  })
  // Ctrl+, is not wired up — modal type should remain null.
  expect(modalState).toBeNull() // parity gap: should be 'settings' in Obsidian
})

test('command palette path opens settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open command palette.
  await page.keyboard.press('Control+Shift+p')
  await expect(page.getByTestId('command-palette-input')).toBeVisible()

  // Type "settings" to filter.
  await page.getByTestId('command-palette-input').fill('settings')

  // Wait for results.
  await expect(page.getByTestId('command-palette-list')).toBeVisible()

  // Press Enter to open the first matching command (Open Settings).
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)

  // The settings modal should now be open — check via testid.
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
})
