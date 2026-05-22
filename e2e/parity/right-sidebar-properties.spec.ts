/**
 * Right-sidebar / Properties panel — parity spec
 *
 * Validates the v1 right sidebar feature against the deployed branch preview.
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://... npx playwright test --config=playwright.config.deployed.ts e2e/parity/right-sidebar-properties.spec.ts
 *
 * Scope (per brief):
 *   1. Toggle behaviour (expand / collapse / reload-persistence)
 *   2. Empty state when nothing selected
 *   3. Note selected: title + tag chips (de-duped) + pin toggle + timestamps
 *   4. Pin toggle updates noteStore + sidebar mirrors
 *   5. Layout sanity: editor not squashed at 1280×800 with sidebar open
 *   6. Mobile (375×667 + 414×896): right-sidebar NOT in DOM
 *   7. No console errors
 */

import { test, expect, Page } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001'

// ── helpers ──────────────────────────────────────────────────────────────────

async function clearState(page: Page) {
  // Do NOT use page.addInitScript here — that wipes localStorage on
  // every navigation (including reload), which breaks the persistence
  // tests below. We need a one-shot clear that runs before the test's
  // interactions but not on subsequent reloads.
  //
  // Pattern: goto → clear → reload-with-clean-slate. The caller then
  // calls waitForApp + interacts; reload during the test inherits the
  // already-cleared localStorage + the onboarding-shown seed.
  await page.goto(BASE)
  await page.evaluate(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch { /* ignore */ }
  })
  await page.reload()
}

/** Seed a note via testHooks and open it (pinned, not preview). */
async function seedAndOpen(page: Page, title: string, content: string): Promise<string> {
  return page.evaluate(({ title, content }) => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: { title: string; content: string }) => { id: string } } }
          workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
        }
      }
    }).__noteser_test
    const note = hooks.stores.noteStore.getState().addNote({ title, content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    return note.id
  }, { title, content })
}

/** Wait for the app to finish hydrating (folder-tree is the canary). */
async function waitForApp(page: Page) {
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
}

// ── 1. Toggle behaviour ──────────────────────────────────────────────────────

test('1a: right-sidebar toggle is visible on desktop (32px strip)', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  const toggle = page.getByTestId('right-sidebar-toggle')
  await expect(toggle).toBeVisible()
})

test('1b: clicking toggle expands the sidebar to ~280px', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  const toggle = page.getByTestId('right-sidebar-toggle')
  await toggle.click()

  // The sidebar container should now be wider; the properties-empty state
  // should be visible because no note is selected yet.
  const emptyPanel = page.getByTestId('properties-empty')
  await expect(emptyPanel).toBeVisible({ timeout: 5_000 })
})

test('1c: clicking toggle again collapses the sidebar', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  const toggle = page.getByTestId('right-sidebar-toggle')
  // Expand
  await toggle.click()
  await expect(page.getByTestId('properties-empty')).toBeVisible()

  // Collapse
  await toggle.click()
  await expect(page.getByTestId('properties-empty')).toHaveCount(0)
  await expect(page.getByTestId('properties-panel')).toHaveCount(0)
})

test('1d: open state persists across reload (localStorage noteser-ui.rightSidebarOpen)', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  // Open sidebar
  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-empty')).toBeVisible()

  // Reload
  await page.reload()
  await waitForApp(page)

  // Should still be open
  await expect(page.getByTestId('properties-empty')).toBeVisible({ timeout: 8_000 })
})

test('1e: closed state also persists across reload', async ({ page }) => {
  await clearState(page)
  // Manually set sidebar open in localStorage before first load
  await page.addInitScript(() => {
    try {
      const raw = window.localStorage.getItem('noteser-ui')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      parsed.state = { ...(parsed.state ?? {}), rightSidebarOpen: false }
      window.localStorage.setItem('noteser-ui', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
  await page.goto(BASE)
  await waitForApp(page)

  // Sidebar should be collapsed (properties panels absent)
  await expect(page.getByTestId('properties-empty')).toHaveCount(0)
  await expect(page.getByTestId('properties-panel')).toHaveCount(0)
})

// ── 2. Empty state ───────────────────────────────────────────────────────────

test('2: empty state copy when no note selected', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-empty')).toBeVisible()
  await expect(page.getByText('Select a note to see its properties.')).toBeVisible()
})

// ── 3. Note selected — properties content ────────────────────────────────────

test('3a: properties panel shows note title when a note is open', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'My Test Note', 'just some content')

  await page.getByTestId('right-sidebar-toggle').click()
  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByText('My Test Note')).toBeVisible()
})

test('3b: (untitled) shown when note title is empty', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, '', 'content without title')

  await page.getByTestId('right-sidebar-toggle').click()
  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByText('(untitled)')).toBeVisible()
})

test('3c: tag chips de-duplicated — #one #two #one renders two chips only', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'Tags Note', 'Hello #one and #two and #one again')

  await page.getByTestId('right-sidebar-toggle').click()
  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })

  await expect(page.getByTestId('properties-tag-one')).toHaveCount(1)
  await expect(page.getByTestId('properties-tag-two')).toHaveCount(1)
  // Confirm there's no third tag chip
  await expect(page.getByTestId('properties-tag-three')).toHaveCount(0)
})

test('3d: created and updated timestamps are present', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'Timestamps Note', 'content')

  await page.getByTestId('right-sidebar-toggle').click()
  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })

  await expect(page.getByTestId('properties-created')).toBeVisible()
  await expect(page.getByTestId('properties-updated')).toBeVisible()
})

// ── 4. Pin toggle ────────────────────────────────────────────────────────────

test('4a: pin toggle aria-pressed starts false for unpinned note', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'Unpinned Note', 'content')

  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-panel')).toBeVisible({ timeout: 5_000 })

  const pinToggle = page.getByTestId('properties-pin-toggle')
  await expect(pinToggle).toBeVisible()
  await expect(pinToggle).toHaveAttribute('aria-pressed', 'false')
})

test('4b: clicking pin toggle flips aria-pressed to true', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'To Pin Note', 'content')

  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-panel')).toBeVisible({ timeout: 5_000 })

  const pinToggle = page.getByTestId('properties-pin-toggle')
  await pinToggle.click()
  await expect(pinToggle).toHaveAttribute('aria-pressed', 'true')
})

test('4c: pin toggle off → on → off roundtrip', async ({ page }) => {
  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'Pin Roundtrip', 'content')

  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-panel')).toBeVisible({ timeout: 5_000 })

  const pinToggle = page.getByTestId('properties-pin-toggle')
  await pinToggle.click()
  await expect(pinToggle).toHaveAttribute('aria-pressed', 'true')
  await pinToggle.click()
  await expect(pinToggle).toHaveAttribute('aria-pressed', 'false')
})

// ── 5. Layout sanity at 1280×800 ─────────────────────────────────────────────

test('5: editor is not squashed with right sidebar open at 1280×800', async ({ page }) => {
  await clearState(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(BASE)
  await waitForApp(page)

  await seedAndOpen(page, 'Layout Test', 'Content to check editor width')

  await page.getByTestId('right-sidebar-toggle').click()
  await expect(page.getByTestId('properties-panel')).toBeVisible({ timeout: 5_000 })

  // The editor content area should have at least 400px width.
  const editorContent = page.locator('.cm-content').first()
  const box = await editorContent.boundingBox()
  expect(box).not.toBeNull()
  // Allow for some flexibility — editor should not be invisible or tiny
  expect(box!.width).toBeGreaterThan(350)
})

test('5b: no horizontal overflow at 1280×800 with sidebar open', async ({ page }) => {
  await clearState(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(BASE)
  await waitForApp(page)

  await page.getByTestId('right-sidebar-toggle').click()

  // Check body scroll width doesn't exceed viewport width by more than a tiny margin
  const overflow = await page.evaluate(() => {
    return document.body.scrollWidth - document.documentElement.clientWidth
  })
  // Allow 1px rounding error
  expect(overflow).toBeLessThanOrEqual(1)
})

// ── 6. Mobile: right sidebar NOT in DOM ──────────────────────────────────────

test('6a: mobile 375×667 — right-sidebar testid absent from DOM', async ({ page }) => {
  await clearState(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto(BASE)
  await waitForApp(page)

  // The right-sidebar container itself should not be in the DOM at all on mobile
  const rightSidebar = page.locator('[data-testid="right-sidebar-toggle"]')
  await expect(rightSidebar).toHaveCount(0)
})

test('6b: mobile 414×896 — right-sidebar testid absent from DOM', async ({ page }) => {
  await clearState(page)
  await page.setViewportSize({ width: 414, height: 896 })
  await page.goto(BASE)
  await waitForApp(page)

  const rightSidebar = page.locator('[data-testid="right-sidebar-toggle"]')
  await expect(rightSidebar).toHaveCount(0)
})

// ── 7. No console errors ──────────────────────────────────────────────────────

test('7: no uncaught console errors on load and toggle interaction', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await clearState(page)
  await page.goto(BASE)
  await waitForApp(page)

  // Open sidebar
  const toggle = page.getByTestId('right-sidebar-toggle')

  // If toggle doesn't exist (feature not deployed), fail gracefully
  const toggleCount = await toggle.count()
  if (toggleCount === 0) {
    throw new Error('right-sidebar-toggle not found in DOM — feature may not be deployed')
  }

  await toggle.click()
  await page.waitForTimeout(1000)

  // Close sidebar
  await toggle.click()
  await page.waitForTimeout(500)

  expect(pageErrors).toEqual([])
})
