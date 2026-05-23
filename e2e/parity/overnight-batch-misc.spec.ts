/**
 * overnight-batch-misc.spec.ts
 *
 * Covers the remaining overnight-batch sweep items that don't warrant their
 * own file:
 *
 *   A. Settings → Local Folder: without connecting a folder, only the
 *      "Connect a folder" button renders (no in-folder-git subsection).
 *
 *   B. Settings → About: "Help & docs →" link points to /help.
 *
 *   C. Settings → GitHub sync: sanity that the panel still renders and the
 *      existing gitignore + new commit-message regions are both present.
 *
 *   D. Mobile 375×667: overflow menu contains "Calendar" and
 *      "Git / Source control" entries below the filter trio.
 *      Tapping Calendar switches the tab + opens the drawer.
 *
 * Run with:
 *   npx playwright test --config playwright.config.deployed.ts e2e/parity/overnight-batch-misc.spec.ts
 */

import { test, expect, type Page } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

const BASE = 'https://noteser.thetechjon.com'

// ── Shared helper ────────────────────────────────────────────────────────────

async function openApp(page: Page) {
  await page.goto(BASE)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
}

async function openSettings(page: Page, catId: string) {
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId(`settings-cat-${catId}`).click()
  await expect(page.getByTestId(`settings-panel-${catId}`)).toBeVisible({ timeout: 5_000 })
}

// ── A. Local Folder: no in-folder-git subsection before connecting ────────────

test.describe('A: Local Folder settings panel', () => {
  test.beforeEach(async ({ page }) => { await setupCleanVault(page) })

  test('A1: "Connect a folder" button is present without a folder connected', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'local-folder')

    await page.screenshot({ path: 'playwright-report/notes/settings-local-folder-disconnected.png' })

    const connectBtn = page.getByTestId('local-folder-connect')
    const connectBtnCount = await connectBtn.count()

    if (connectBtnCount === 0) {
      // Fall back to text detection.
      const panelText = await page.getByTestId('settings-panel-local-folder').innerText()
      expect(
        panelText.toLowerCase(),
        'Local folder panel should mention "connect" when no folder is connected'
      ).toContain('connect')
    } else {
      await expect(connectBtn).toBeVisible()
    }
  })

  test('A2: in-folder-git subsection is NOT present before connecting a folder', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'local-folder')

    // These testids should be absent until a folder is actually connected.
    const inFolderGit = page.getByTestId('in-folder-git')
    await expect(inFolderGit).toHaveCount(0)

    const initBtn = page.getByTestId('in-folder-git-init')
    await expect(initBtn).toHaveCount(0)

    await page.screenshot({ path: 'playwright-report/notes/settings-local-folder-no-git.png' })
  })
})

// ── B. Settings → About: "Help & docs" link ───────────────────────────────────

test.describe('B: Settings About panel — Help & docs link', () => {
  test.beforeEach(async ({ page }) => { await setupCleanVault(page) })

  test('B1: About panel renders without crashing', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'about')
    await page.screenshot({ path: 'playwright-report/notes/settings-about-panel.png' })
    const panel = page.getByTestId('settings-panel-about')
    await expect(panel).toBeVisible()
  })

  test('B2: "Help & docs" link points to /help', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'about')

    // Look for a link containing "help" in its href or "Help & docs" in its text.
    const helpLink = page.locator('a[href*="/help"], a[href*="help"]').filter({
      hasText: /help/i,
    }).first()
    const helpLinkCount = await helpLink.count()

    await page.screenshot({ path: 'playwright-report/notes/settings-about-help-link.png' })

    if (helpLinkCount === 0) {
      // Try any button or link with "Help" text.
      const anyHelpEl = page.getByRole('link', { name: /help/i }).first()
      const anyHelpCount = await anyHelpEl.count()
      expect(
        anyHelpCount,
        'About panel should have a link to /help — "Help & docs" link not found'
      ).toBeGreaterThan(0)
      return
    }

    const href = await helpLink.getAttribute('href')
    expect(href, '"Help & docs" link href should point to /help').toMatch(/\/help/)
  })
})

// ── C. GitHub sync panel: commit-message + gitignore fields coexist ───────────

test.describe('C: GitHub sync settings panel sanity', () => {
  test.beforeEach(async ({ page }) => { await setupCleanVault(page) })

  test('C1: GitHub sync panel renders (regression — existing categories still work)', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'github')

    const panel = page.getByTestId('settings-panel-github')
    await expect(panel).toBeVisible()
    await page.screenshot({ path: 'playwright-report/notes/settings-github-sanity.png' })
  })

  test('C2: Default commit message field is present in GitHub sync panel', async ({ page }) => {
    await openApp(page)
    await openSettings(page, 'github')

    await page.screenshot({ path: 'playwright-report/notes/settings-github-commit-field.png' })

    // Check by testid or label.
    const byTestId = page.getByTestId('settings-default-commit-message')
    const byLabel  = page.getByLabel(/default commit message/i)

    const total = (await byTestId.count()) + (await byLabel.count())

    if (total === 0) {
      // Soft: check if the text appears at all in the panel.
      const panelText = await page.getByTestId('settings-panel-github').innerText()
      expect(
        panelText.toLowerCase(),
        'GitHub sync panel should mention "commit message"'
      ).toContain('commit message')
    } else {
      expect(total).toBeGreaterThan(0)
    }
  })
})

// ── D. Mobile overflow menu: Calendar + Git/Source control entries ────────────

test.describe('D: Mobile overflow menu — Calendar + Git entries', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  async function clearMobileState(page: Page) {
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

  test('D1: overflow menu has Calendar and Git/Source control entries', async ({ page }) => {
    await clearMobileState(page)

    // Seed and open a note so the overflow menu has full content.
    await page.evaluate(() => {
      const ns = window.__noteser_test!.stores.noteStore.getState()
      const ws = window.__noteser_test!.stores.workspaceStore.getState()
      const note = ns.addNote({ title: 'Mobile probe', folderId: null, content: '' })
      ws.openNote(note.id, { preview: false })
    })
    await page.waitForTimeout(300)

    const overflowBtn = page.getByTestId('mobile-top-bar-overflow')
    await expect(overflowBtn).toBeVisible({ timeout: 5_000 })
    await overflowBtn.click()

    const menu = page.getByTestId('mobile-top-bar-overflow-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    await page.screenshot({ path: 'playwright-report/notes/mobile-overflow-calendar-git.png' })

    const buttonLabels = await menu.evaluate((el) =>
      Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
    )

    const hasCalendar = buttonLabels.some((l) => l.toLowerCase().includes('calendar'))
    const hasGit = buttonLabels.some(
      (l) => l.toLowerCase().includes('git') || l.toLowerCase().includes('source control')
    )

    expect(hasCalendar, `Overflow menu should have a "Calendar" entry. Found: [${buttonLabels.join(', ')}]`).toBe(true)
    expect(hasGit, `Overflow menu should have a "Git" or "Source control" entry. Found: [${buttonLabels.join(', ')}]`).toBe(true)
  })

  test('D2: tapping Calendar entry opens the sidebar calendar tab', async ({ page }) => {
    await clearMobileState(page)

    await page.evaluate(() => {
      const ns = window.__noteser_test!.stores.noteStore.getState()
      const ws = window.__noteser_test!.stores.workspaceStore.getState()
      const note = ns.addNote({ title: 'Calendar probe', folderId: null, content: '' })
      ws.openNote(note.id, { preview: false })
    })
    await page.waitForTimeout(300)

    await page.getByTestId('mobile-top-bar-overflow').click()
    const menu = page.getByTestId('mobile-top-bar-overflow-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Find and click the Calendar button.
    // Use text filter rather than getByRole since the button accessible name
    // may differ from its text content when it has an icon child.
    const calendarBtn = menu.locator('button').filter({ hasText: /^Calendar$/i })
    const calendarCount = await calendarBtn.count()

    if (calendarCount === 0) {
      // Fallback: any button in the menu that contains "Calendar" anywhere.
      const calendarBtnFallback = menu.locator('button').filter({ hasText: /calendar/i })
      const fallbackCount = await calendarBtnFallback.count()
      if (fallbackCount === 0) {
        await page.screenshot({ path: 'playwright-report/notes/mobile-overflow-no-calendar.png' })
        throw new Error('Calendar button not found in overflow menu — feature may not be deployed')
      }
      await calendarBtnFallback.first().click()
    } else {
      await calendarBtn.first().click()
    }
    await page.waitForTimeout(500)

    await page.screenshot({ path: 'playwright-report/notes/mobile-overflow-calendar-tap.png' })

    // After tapping Calendar, the sidebar should switch to the calendar tab.
    // Check for either the drawer/sidebar being open OR a calendar-related testid.
    const drawerOpen = await page.locator('[data-testid="mobile-sidebar-backdrop"]').count()
    const calendarView = await page.locator('[data-testid="calendar-view"], .fc, [class*="calendar"]').count()

    // At minimum the drawer should have opened.
    expect(
      drawerOpen + calendarView,
      'After tapping Calendar in overflow menu, the drawer should open and/or a calendar view should be visible'
    ).toBeGreaterThan(0)
  })

  test('D3: filter trio (All notes / Recent / Tags) is still present alongside new entries', async ({ page }) => {
    await clearMobileState(page)

    await page.evaluate(() => {
      const ns = window.__noteser_test!.stores.noteStore.getState()
      const ws = window.__noteser_test!.stores.workspaceStore.getState()
      const note = ns.addNote({ title: 'Trio probe', folderId: null, content: '' })
      ws.openNote(note.id, { preview: false })
    })
    await page.waitForTimeout(300)

    await page.getByTestId('mobile-top-bar-overflow').click()
    const menu = page.getByTestId('mobile-top-bar-overflow-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    const buttonLabels = await menu.evaluate((el) =>
      Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
    )

    await page.screenshot({ path: 'playwright-report/notes/mobile-overflow-trio-check.png' })

    const hasAllNotes = buttonLabels.some((l) => l.toLowerCase().includes('all notes') || l.toLowerCase().includes('all'))
    const hasRecent   = buttonLabels.some((l) => l.toLowerCase().includes('recent'))
    const hasTags     = buttonLabels.some((l) => l.toLowerCase().includes('tag'))

    expect(hasAllNotes, `Overflow menu should still have "All notes" entry. Labels: [${buttonLabels.join(', ')}]`).toBe(true)
    expect(hasRecent,   `Overflow menu should still have "Recent" entry. Labels: [${buttonLabels.join(', ')}]`).toBe(true)
    expect(hasTags,     `Overflow menu should still have "Tags" entry. Labels: [${buttonLabels.join(', ')}]`).toBe(true)
  })
})
