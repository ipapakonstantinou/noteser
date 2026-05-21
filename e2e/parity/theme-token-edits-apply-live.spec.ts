import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: theme-token-edits-apply-live
//
// Obsidian behavior (themes plugin): editing a color token causes the
// UI to repaint immediately, no reload, no save step.
//
// Noteser today: Settings → Appearance writes each token into the
// settingsStore.themeOverrides map. `useApplyTheme` mirrors that map
// onto :root CSS variables via `style.setProperty('--obsidian-*', …)`.
// Tailwind classes pointing at those vars then resolve to the new
// color on the next paint.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function openSettingsAppearance(page: import('@playwright/test').Page) {
  // The Settings cog in the Ribbon lives at the bottom-left edge of the
  // viewport — same coords as the Next.js dev-indicator portal in dev
  // mode, which intercepts the click. Drive the modal open via the test
  // hook the app exposes for E2E (`window.__noteser_test.stores.uiStore`)
  // so the test isn't fighting the framework's overlay.
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 5000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
  await page.getByTestId('settings-cat-appearance').click()
  // Two elements carry `data-testid="settings-panel-appearance"`: the
  // outer container (`settings-panel-${active}`) and the inner panel
  // (`AppearancePanel`'s root). `.first()` picks the outer; both being
  // present is the success signal anyway.
  await expect(page.getByTestId('settings-panel-appearance').first()).toBeVisible()
}

test('editing a token via the color picker mutates the :root CSS var live', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openSettingsAppearance(page)

  // Pick a known token. The "Background" token cssVar is "obsidian-black".
  const input = page.getByTestId('theme-input-obsidian-black')
  await expect(input).toBeVisible()

  // Drive the color input. React listens for `change` on color inputs,
  // and Playwright's `.fill()` on a color input both sets the value and
  // fires the canonical change event so the React handler runs.
  await input.fill('#ff00aa')

  // useApplyTheme runs on the next React commit; assert the :root
  // CSS variable reflects the new value.
  await expect.poll(
    async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--obsidian-black')),
    { message: '--obsidian-black should reflect the new picker value' },
  ).toBe('#ff00aa')
})

test('Light preset switches the palette in-place (Background becomes white)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openSettingsAppearance(page)
  await page.getByTestId('theme-preset-light').click()

  await expect.poll(
    async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--obsidian-black')),
    { message: '--obsidian-black should be the light preset value' },
  ).toBe('#ffffff')

  // Reset clears overrides → CSS var goes back to empty (the
  // globals.css default takes over).
  await page.getByTestId('theme-reset').click()
  await expect.poll(
    async () => page.evaluate(() => document.documentElement.style.getPropertyValue('--obsidian-black')),
    { message: 'reset should clear inline --obsidian-black' },
  ).toBe('')
})
