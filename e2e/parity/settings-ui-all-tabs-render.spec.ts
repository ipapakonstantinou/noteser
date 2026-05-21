import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// settings-ui-all-tabs-render
//
// Regression sweep: open Settings and click every category in the left nav.
// Each panel must render without crashing. Panels with PanelHeading (<h3>)
// also get a heading-text assertion. Delegated section components
// (Attachments, AI, DailyNotes, Templates, Shortcuts, Export) don't use
// PanelHeading, so only the outer panel div visibility is asserted for them.
//
// Target: https://noteser.thetechjon.com (deployed build — no dev indicator).

const BASE_URL = 'https://noteser.thetechjon.com'

// `headingText` is set only for inline panels that use PanelHeading (<h3>).
// Delegated section components don't render an <h3> — skip heading assertion.
const CATEGORIES: { id: string; headingText?: string }[] = [
  { id: 'general',     headingText: 'General' },
  { id: 'appearance',  headingText: 'Appearance' },
  { id: 'editor',      headingText: 'Editor' },
  { id: 'attachments' },   // AttachmentsSection — no PanelHeading
  { id: 'daily-notes' },   // DailyNotesSection — no PanelHeading
  { id: 'templates' },     // TemplatesSection — no PanelHeading
  { id: 'github',      headingText: 'GitHub sync' },
  { id: 'ai' },            // AISection — no PanelHeading
  { id: 'shortcuts' },     // ShortcutsSection — no PanelHeading
  { id: 'export' },        // ExportSection — no PanelHeading
  { id: 'beta',        headingText: 'Beta features' },
  { id: 'about',       headingText: 'About' },
]

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('all settings categories render their panel without crashing', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open settings via the store API — robust on both dev and deployed
  // (avoids fighting any overlay portal that might intercept the cog click).
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })

  for (const cat of CATEGORIES) {
    // Click the category nav button.
    await page.getByTestId(`settings-cat-${cat.id}`).click()

    // The outer panel div changes testid to `settings-panel-${active}`.
    // The `appearance` panel has TWO elements with the same testid (outer
    // container + AppearancePanel inner div). Use .first() to avoid
    // strict-mode failures.
    const panelLocator = page.getByTestId(`settings-panel-${cat.id}`).first()
    await expect(panelLocator).toBeVisible({ timeout: 3_000 })

    // For panels that have a PanelHeading (<h3>), assert the heading text.
    if (cat.headingText) {
      await expect(
        page.getByTestId(`settings-panel-${cat.id}`)
          .locator('h3')
          .filter({ hasText: cat.headingText })
          .first()
      ).toBeVisible({ timeout: 3_000 })
    }
  }

  // No React error boundaries should have fired.
  const reactErrors = consoleErrors.filter(e =>
    e.includes('Error') || e.includes('exception') || e.includes('Uncaught')
  )
  expect(reactErrors, `Console errors during settings sweep: ${reactErrors.join('\n')}`).toHaveLength(0)
})

test('settings-beta-panel testid is present when Beta tab is active', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
  await page.getByTestId('settings-cat-beta').click()

  // BetaPanel explicitly sets data-testid="settings-beta-panel".
  await expect(page.getByTestId('settings-beta-panel')).toBeVisible()
  // Count should be exactly 1 (the inner panel div).
  expect(await page.getByTestId('settings-beta-panel').count()).toBe(1)
})
