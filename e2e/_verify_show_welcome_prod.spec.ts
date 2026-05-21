import { test, expect } from '@playwright/test'

const PROD = 'https://noteser.thetechjon.com'

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

test('prod: noteser favicon SVG is served + linked in HTML', async ({ page }) => {
  const resp = await page.goto(PROD)
  expect(resp?.status()).toBe(200)
  const iconHref = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(iconHref).toContain('/icon.svg')
  // Fetch the SVG and confirm it has our purple "N" path (fill #8b5cf6).
  const svg = await (await page.request.get(`${PROD}${iconHref}`)).text()
  expect(svg).toContain('#8b5cf6')
  expect(svg).toContain('viewBox="0 0 32 32"')
})

test('prod: Settings → General has a Show welcome tab button', async ({ page }) => {
  await page.goto(PROD)
  await page.waitForFunction(() => !!window.__noteser_test)
  // Whatever the initial state, force "welcome dismissed": mark
  // onboardingShown true AND close every existing welcome tab so we
  // know the next visible welcome-pane was opened by our button.
  await page.evaluate(() => {
    const ui = window.__noteser_test!.stores.uiStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    window.__noteser_test!.stores.settingsStore.getState().setOnboardingShown(true)
    // Close any welcome tab(s) anywhere.
    for (const p of ws.panes) {
      for (const t of p.tabs) {
        if (t.kind === 'welcome') ws.closeTab(t.id)
      }
    }
    void ui // satisfy linter
  })
  await page.waitForTimeout(200)
  await expect(page.getByTestId('welcome-pane')).toHaveCount(0)

  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await page.getByRole('button', { name: /^General$/ }).first().click()
  await page.waitForTimeout(150)
  await page.getByTestId('settings-show-welcome').click()
  await page.waitForTimeout(300)
  await expect(page.getByTestId('welcome-pane')).toBeVisible()
})

test('prod: Feature tour body has the "Coming back to this tour" section', async ({ page }) => {
  await page.goto(PROD)
  await page.waitForFunction(() => !!window.__noteser_test)
  // The body is generated client-side. Trigger the seed and read the
  // resulting note content.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.getState().setOnboardingShown(false)
  })
  await page.reload()
  await page.waitForFunction(() => !!window.__noteser_test)
  await expect(page.getByTestId('welcome-feature-tour')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('welcome-feature-tour').click()
  await page.waitForTimeout(2500)
  const content = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    const t = notes.find(n => !n.isDeleted && n.title === 'Feature tour')
    return t?.content ?? null
  })
  expect(content).toContain('Coming back to this tour')
  expect(content).toContain('Show welcome tab')
})
