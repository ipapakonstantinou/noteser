import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// settings-ui-theme-tokens-apply-live
//
// Obsidian parity: editing a theme color token applies immediately to the
// rendered UI without a reload (Obsidian themes plugin behavior).
//
// Noteser implementation: settingsStore.setThemeToken(cssVar, value) updates
// themeOverrides; useApplyTheme mirrors the map onto :root via
// document.documentElement.style.setProperty('--<cssVar>', value).
//
// Tests:
//   1. setThemeToken via store → :root CSS var mutates live.
//   2. setThemeOverrides({}) (reset) → :root CSS var is cleared.
//   3. Color picker input in the Appearance panel drives the same path.
//
// NOTE: tokens that are NOT overridden return empty string from
//   getComputedStyle().getPropertyValue() — Tailwind uses the fallback.
//   After reset, the inline style is removed, so getPropertyValue returns ''.
//
// Target: https://noteser.thetechjon.com (deployed build).

const BASE_URL = 'https://noteser.thetechjon.com'

async function openAppearancePanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 10_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
  await page.getByTestId('settings-cat-appearance').click()
  await expect(page.getByTestId('settings-panel-appearance').first()).toBeVisible({ timeout: 3_000 })
}

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
  // Ensure no leftover theme overrides from a previous run.
  await page.addInitScript(() => {
    // Already cleared by setupCleanVault; this is belt-and-suspenders.
    try { window.localStorage.removeItem('noteser-settings') } catch { /* ignore */ }
  })
})

// ── Test 1: store API drives :root CSS var ───────────────────────────────────

test('setThemeToken applies CSS var to :root inline style live', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Force a known value via the store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setThemeToken('obsidian-black', '#123456')
  })

  // useApplyTheme runs on next React commit — poll until the inline var appears.
  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { message: '--obsidian-black should be #123456 after setThemeToken', timeout: 5_000 }
  ).toBe('#123456')
})

// ── Test 2: setThemeOverrides({}) clears the :root var ──────────────────────

test('setThemeOverrides({}) clears the :root CSS var (returns empty string)', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // First set a token so there is something to clear.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setThemeToken('obsidian-black', '#abcdef')
  })
  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { timeout: 5_000 }
  ).toBe('#abcdef')

  // Now reset all overrides.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setThemeOverrides({})
  })

  // The inline style should now return empty string (no override).
  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { message: '--obsidian-black should be empty after reset', timeout: 5_000 }
  ).toBe('')
})

// ── Test 3: resetThemeOverrides() (the "Reset all" button path) ──────────────

test('resetThemeOverrides clears all :root token overrides', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Set two tokens.
  await page.evaluate(() => {
    const s = window.__noteser_test!.stores.settingsStore.getState()
    s.setThemeToken('obsidian-black', '#111111')
    s.setThemeToken('obsidian-text', '#eeeeee')
  })

  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { timeout: 5_000 }
  ).toBe('#111111')

  // Call resetThemeOverrides (what the "Reset all" button calls).
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().resetThemeOverrides()
  })

  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { message: '--obsidian-black should be cleared after resetThemeOverrides', timeout: 5_000 }
  ).toBe('')

  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-text').trim()
    ),
    { message: '--obsidian-text should be cleared after resetThemeOverrides', timeout: 5_000 }
  ).toBe('')
})

// ── Test 4: color picker input in the Appearance panel drives the same path ──

test('color picker input in Appearance panel mutates :root CSS var live', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openAppearancePanel(page)

  // Find the "Background" token color picker (data-testid="theme-input-obsidian-black").
  const input = page.getByTestId('theme-input-obsidian-black')
  await expect(input).toBeVisible()

  // Fill the color input. Playwright fires the change event, React handler runs.
  await input.fill('#ff00aa')

  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { message: '--obsidian-black should reflect color picker value', timeout: 5_000 }
  ).toBe('#ff00aa')

  // Use the "Reset all" button to revert.
  await page.getByTestId('theme-reset').click()

  await expect.poll(
    () => page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--obsidian-black').trim()
    ),
    { message: '--obsidian-black should be empty after Reset all', timeout: 5_000 }
  ).toBe('')
})
