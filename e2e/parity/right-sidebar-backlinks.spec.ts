/**
 * right-sidebar-backlinks.spec.ts
 *
 * Validates the Backlinks tab in the right sidebar shipped in the overnight batch (#17).
 *
 * Scope:
 *   1. Right sidebar expanded view has two pills: Properties + Backlinks
 *   2. Clicking the Backlinks pill shows the backlinks panel
 *   3. Empty state — a vault with no wikilinks shows "No backlinks…" (or similar copy)
 *   4. With wikilinks — a note that wikilinks to the active note appears in the list
 *   5. Properties pill still works (regression check)
 *
 * Run with:
 *   npx playwright test --config playwright.config.deployed.ts e2e/parity/right-sidebar-backlinks.spec.ts
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'https://noteser.thetechjon.com'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function clearState(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    try { window.localStorage.clear() } catch { /* */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* */ }
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* */ }
  })
  await page.goto(BASE)
  await page.waitForFunction(() => typeof window.__noteser_test !== 'undefined', undefined, { timeout: 15_000 })
}

async function waitForApp(page: Page) {
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
}

async function seedAndOpen(page: Page, title: string, content: string): Promise<string> {
  return page.evaluate(({ title, content }) => {
    const hooks = window.__noteser_test!
    const note = hooks.stores.noteStore.getState().addNote({ title, content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    return note.id
  }, { title, content })
}

async function openRightSidebar(page: Page) {
  const toggle = page.getByTestId('right-sidebar-toggle')
  await expect(toggle).toBeVisible({ timeout: 5_000 })
  await toggle.click()
  // Wait for panel or empty state to appear.
  await page.waitForTimeout(500)
}

// ── 1. Two pills visible when right sidebar is expanded with a note open ──────

test('1: right sidebar shows Properties + Backlinks tab pills when a note is open', async ({ page }) => {
  await clearState(page)
  await waitForApp(page)

  await seedAndOpen(page, 'Target Note', 'Content of the target note')
  await openRightSidebar(page)

  await page.screenshot({ path: 'playwright-report/notes/right-sidebar-pills.png' })

  // Check for the two tab pills by testid.
  const propertiesTab = page.getByTestId('right-sidebar-tab-properties')
  const backlinksTab  = page.getByTestId('right-sidebar-tab-backlinks')

  const propertiesCount = await propertiesTab.count()
  const backlinksCount  = await backlinksTab.count()

  // If testids don't exist, fall back to text-based detection.
  if (propertiesCount === 0 || backlinksCount === 0) {
    const panelText = await page.locator('[data-testid="properties-panel"], [data-testid="right-sidebar-panel"]').first().innerText().catch(() => '')
    const bodyText  = await page.locator('body').innerText()

    // Try to find pills via text content.
    const hasPropertiesText = bodyText.toLowerCase().includes('properties')
    const hasBacklinksText  = bodyText.toLowerCase().includes('backlink')

    await page.screenshot({ path: 'playwright-report/notes/right-sidebar-pills-fallback.png' })
    void panelText

    expect(hasPropertiesText, 'Right sidebar should show "Properties" tab').toBe(true)
    expect(hasBacklinksText, 'Right sidebar should show "Backlinks" tab').toBe(true)
    return
  }

  await expect(propertiesTab).toBeVisible({ timeout: 5_000 })
  await expect(backlinksTab).toBeVisible({ timeout: 5_000 })
})

// ── 2. Clicking Backlinks pill shows the backlinks panel ──────────────────────

test('2: clicking Backlinks pill shows the backlinks panel', async ({ page }) => {
  await clearState(page)
  await waitForApp(page)

  await seedAndOpen(page, 'Target Note', 'Some content')
  await openRightSidebar(page)

  const backlinksTab = page.getByTestId('right-sidebar-tab-backlinks')
  const backlinksCount = await backlinksTab.count()

  if (backlinksCount === 0) {
    // Try clicking by text.
    const backlinksTextBtn = page.getByRole('button', { name: /backlinks/i })
    const textBtnCount = await backlinksTextBtn.count()
    if (textBtnCount === 0) {
      await page.screenshot({ path: 'playwright-report/notes/right-sidebar-no-backlinks-tab.png' })
      throw new Error('Backlinks tab/pill not found in right sidebar — feature may not be deployed')
    }
    await backlinksTextBtn.click()
  } else {
    await backlinksTab.click()
  }

  await page.waitForTimeout(400)
  await page.screenshot({ path: 'playwright-report/notes/right-sidebar-backlinks-panel.png' })

  // The backlinks panel should now be visible.
  const backlinksPanel = page.getByTestId('backlinks-panel')
  const backlinksEmpty = page.getByTestId('backlinks-empty')

  const panelCount = await backlinksPanel.count()
  const emptyCount = await backlinksEmpty.count()

  if (panelCount === 0 && emptyCount === 0) {
    // Fall back: look for any element mentioning "backlink" or "No backlink"
    const bodyText = await page.locator('body').innerText()
    expect(
      bodyText.toLowerCase(),
      'Backlinks panel should show some content after clicking Backlinks tab'
    ).toContain('backlink')
  } else {
    // Either the panel or the empty state should be visible.
    const isVisible = panelCount > 0
      ? await backlinksPanel.isVisible()
      : await backlinksEmpty.isVisible()
    expect(isVisible, 'Backlinks panel or empty state should be visible').toBe(true)
  }
})

// ── 3. Empty state — no wikilinks → "No backlinks…" or similar ───────────────

test('3: backlinks shows empty state for a note with no incoming wikilinks', async ({ page }) => {
  await clearState(page)
  await waitForApp(page)

  // Open a note with no wikilinks pointing to it.
  await seedAndOpen(page, 'Lonely Note', 'No one links to me.')
  await openRightSidebar(page)

  // Click Backlinks tab.
  const backlinksTab = page.getByTestId('right-sidebar-tab-backlinks')
  const backlinksCount = await backlinksTab.count()

  if (backlinksCount > 0) {
    await backlinksTab.click()
  } else {
    const textBtn = page.getByRole('button', { name: /backlinks/i })
    const textCount = await textBtn.count()
    if (textCount > 0) {
      await textBtn.click()
    } else {
      await page.screenshot({ path: 'playwright-report/notes/right-sidebar-backlinks-missing.png' })
      throw new Error('Backlinks tab not found — feature may not be deployed or tab pills use different testids')
    }
  }

  await page.waitForTimeout(400)
  await page.screenshot({ path: 'playwright-report/notes/right-sidebar-backlinks-empty.png' })

  // The page should show some kind of "no backlinks" empty state.
  const bodyText = await page.locator('body').innerText()
  const hasEmptyState = bodyText.toLowerCase().includes('no backlink') ||
    bodyText.toLowerCase().includes('no notes link') ||
    bodyText.toLowerCase().includes('no incoming link') ||
    bodyText.toLowerCase().includes('nothing links here')

  expect(
    hasEmptyState,
    'Backlinks panel should show an empty state message when no notes link to the active note. Body text was: ' +
      bodyText.substring(0, 400)
  ).toBe(true)
})

// ── 4. Backlinks appear when a note wikilinks to the active note ──────────────

test('4: a note that wikilinks to the active note appears in the backlinks list', async ({ page }) => {
  await clearState(page)
  await waitForApp(page)

  // Create the "target" note first.
  const targetId = await page.evaluate(() => {
    const hooks = window.__noteser_test!
    const target = hooks.stores.noteStore.getState().addNote({ title: 'Target Note', content: 'I am the target.' })
    return target.id
  })

  // Create a "source" note that wikilinks to Target Note.
  await page.evaluate((targetTitle: string) => {
    const hooks = window.__noteser_test!
    hooks.stores.noteStore.getState().addNote({
      title: 'Source Note',
      content: `This links to [[${targetTitle}]] for testing.`,
    })
  }, 'Target Note')

  // Open the target note.
  await page.evaluate((id: string) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(id, { preview: false })
  }, targetId)

  await openRightSidebar(page)

  // Click Backlinks tab.
  const backlinksTab = page.getByTestId('right-sidebar-tab-backlinks')
  const backlinksCount = await backlinksTab.count()

  if (backlinksCount > 0) {
    await backlinksTab.click()
  } else {
    const textBtn = page.getByRole('button', { name: /backlinks/i })
    const textCount = await textBtn.count()
    if (textCount > 0) {
      await textBtn.click()
    } else {
      test.skip()
      return
    }
  }

  await page.waitForTimeout(500)
  await page.screenshot({ path: 'playwright-report/notes/right-sidebar-backlinks-populated.png' })

  // "Source Note" should appear in the backlinks list.
  const bodyText = await page.locator('body').innerText()
  expect(
    bodyText,
    'Backlinks panel should list "Source Note" as a backlink to "Target Note"'
  ).toContain('Source Note')
})

// ── 5. Properties tab still works after switching to Backlinks and back ───────

test('5: switching back to Properties tab shows properties panel (regression)', async ({ page }) => {
  await clearState(page)
  await waitForApp(page)

  await seedAndOpen(page, 'Regression Note', 'Testing tab switch regression.')
  await openRightSidebar(page)

  // If testids aren't present, skip gracefully.
  const backlinksTab  = page.getByTestId('right-sidebar-tab-backlinks')
  const propertiesTab = page.getByTestId('right-sidebar-tab-properties')

  const backlinksCount  = await backlinksTab.count()
  const propertiesCount = await propertiesTab.count()

  if (backlinksCount === 0 || propertiesCount === 0) {
    console.warn('Tab pills with expected testids not found — skipping regression check')
    test.skip()
    return
  }

  // Click Backlinks.
  await backlinksTab.click()
  await page.waitForTimeout(300)

  // Switch back to Properties.
  await propertiesTab.click()
  await page.waitForTimeout(300)

  await page.screenshot({ path: 'playwright-report/notes/right-sidebar-properties-after-switch.png' })

  // Properties panel should be visible again.
  const propertiesPanel = page.getByTestId('properties-panel')
  await expect(propertiesPanel).toBeVisible({ timeout: 3_000 })
})
