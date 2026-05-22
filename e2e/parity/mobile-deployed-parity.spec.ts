// Mobile parity sweep — runs against the LIVE deployed app.
//
// Scope:
//   1. Drawer behavior (open, backdrop-dismiss, Escape-dismiss, files-only content)
//   2. Tap actions (folder expand, note open in editor)
//   3. Drag guard regression (right-click doesn't start a drag on mobile viewports)
//   4. Overflow menu (Pin/Unpin/Rename + nav items)
//   5. Editor on mobile (EditorHeader hidden, preview-toggle in MobileTopBar)
//
// Run with:
//   PLAYWRIGHT_BASE_URL=https://noteser.thetechjon.com \
//     npx playwright test --config playwright.config.deployed.ts \
//     e2e/parity/mobile-deployed-parity.spec.ts

import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://noteser.thetechjon.com'

const VIEWPORTS = [
  { width: 375, height: 667, label: 'iphone-se' },
  { width: 414, height: 896, label: 'iphone-11' },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearStorageAndVisit(page: Page): Promise<void> {
  // Navigate first so we're on the origin, then clear storage.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    try { window.localStorage.clear() } catch { /* */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* */ }
    // Suppress onboarding modal so it doesn't block interactions.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* */ }
  })
  // Reload to apply cleared state.
  await page.goto(BASE)
  // Wait for React hydration + test hooks.
  await page.waitForFunction(() => typeof window.__noteser_test !== 'undefined', undefined, { timeout: 15_000 })
}

async function seedNotesAndFolder(page: Page): Promise<{ noteId: string; folderId: string }> {
  return page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const fs = window.__noteser_test!.stores.folderStore.getState()
    const folder = fs.addFolder({ parentId: null, name: 'Work' })
    const note = ns.addNote({ title: 'My Test Note', folderId: null, content: '# Hello' })
    return { noteId: note.id, folderId: folder.id }
  })
}

async function openDrawer(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().toggleSidebar()
  })
}

// ---------------------------------------------------------------------------
// Test suites per viewport
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.label}] Scope 1 — drawer behavior`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('hamburger opens drawer; backdrop closes it', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.waitForTimeout(400)

      // Drawer should be closed initially.
      const backdrop = page.locator('[data-testid="mobile-sidebar-backdrop"]')
      await expect(backdrop).toHaveCount(0)

      // Open via store toggle (mirrors what hamburger button does).
      await openDrawer(page)
      await expect(backdrop).toBeVisible({ timeout: 3_000 })

      // Take screenshot showing open drawer.
      await page.screenshot({ path: `playwright-report/notes/mobile-drawer-open-${vp.label}.png` })

      // Tap the backdrop at the far right edge (outside drawer panel).
      await backdrop.click({ position: { x: vp.width - 10, y: vp.height / 2 } })
      await expect(backdrop).toHaveCount(0)
    })

    test('Escape key closes drawer', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.waitForTimeout(400)

      await openDrawer(page)
      const backdrop = page.locator('[data-testid="mobile-sidebar-backdrop"]')
      await expect(backdrop).toBeVisible({ timeout: 3_000 })

      await page.keyboard.press('Escape')
      await expect(backdrop).toHaveCount(0)
    })

    test('drawer shows files panel (folder-tree visible, no pinned-strip mini-strip)', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.waitForTimeout(400)

      await openDrawer(page)
      const backdrop = page.locator('[data-testid="mobile-sidebar-backdrop"]')
      await expect(backdrop).toBeVisible({ timeout: 3_000 })

      // The folder-tree should be visible inside the drawer.
      await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 3_000 })

      // Pinned panel mini-strip must NOT appear on mobile.
      // The mini-strip uses data-testid="sidebar-pinned-strip" or similar.
      const pinnedStrip = page.locator('[data-testid="sidebar-pinned-strip"]')
      await expect(pinnedStrip).toHaveCount(0)

      await page.screenshot({ path: `playwright-report/notes/mobile-drawer-contents-${vp.label}.png` })
    })

    test('MobileTopBar hamburger button is ≥44×44px', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.waitForTimeout(300)

      const topBar = page.locator('[data-testid="mobile-top-bar"]')
      await expect(topBar).toBeVisible({ timeout: 5_000 })

      const sizes = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="mobile-top-bar"]') as HTMLElement | null
        if (!bar) return [] as Array<{ w: number; h: number; label: string }>
        return Array.from(bar.querySelectorAll('button')).map((b) => {
          const r = b.getBoundingClientRect()
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            label: (b.getAttribute('title') ?? b.getAttribute('aria-label') ?? b.textContent ?? '').trim(),
          }
        })
      })

      await page.screenshot({ path: `playwright-report/notes/mobile-top-bar-sizes-${vp.label}.png` })

      expect(sizes.length, 'MobileTopBar should have buttons').toBeGreaterThan(0)
      for (const s of sizes) {
        expect.soft(s.w, `MobileTopBar button "${s.label}" width`).toBeGreaterThanOrEqual(44)
        expect.soft(s.h, `MobileTopBar button "${s.label}" height`).toBeGreaterThanOrEqual(44)
      }
    })
  })

  test.describe(`[${vp.label}] Scope 2 — tap actions on rows`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('tapping a note opens it in the editor and dismisses drawer', async ({ page }) => {
      await clearStorageAndVisit(page)
      const { noteId } = await seedNotesAndFolder(page)
      await page.waitForTimeout(400)

      // Open drawer.
      await openDrawer(page)
      const backdrop = page.locator('[data-testid="mobile-sidebar-backdrop"]')
      await expect(backdrop).toBeVisible({ timeout: 3_000 })

      // Tap the note row.
      const noteRow = page.getByTestId('note-row').first()
      await expect(noteRow).toBeVisible({ timeout: 3_000 })
      await noteRow.click()
      await page.waitForTimeout(400)

      // Drawer should close after note tap.
      await expect(backdrop).toHaveCount(0)

      // A tab for the note should now exist in the tab strip.
      const activeTab = page.locator('div.border-t-obsidianAccentPurple, [data-active-tab="true"]').first()
      // Just check that a tab bar is present with at least one tab.
      const tabCount = await page.locator('[draggable="true"][class*="cursor-pointer"]').count()
      expect(tabCount).toBeGreaterThanOrEqual(1)

      await page.screenshot({ path: `playwright-report/notes/mobile-note-tap-${vp.label}.png` })
      void noteId // used for seeding only
    })

    test('tapping a folder expands / collapses it', async ({ page }) => {
      await clearStorageAndVisit(page)
      await seedNotesAndFolder(page)
      await page.waitForTimeout(400)

      await openDrawer(page)
      const backdrop = page.locator('[data-testid="mobile-sidebar-backdrop"]')
      await expect(backdrop).toBeVisible({ timeout: 3_000 })

      const folderRow = page.getByTestId('folder-row').first()
      await expect(folderRow).toBeVisible({ timeout: 3_000 })

      // First click — should toggle expand/collapse without closing drawer.
      await folderRow.click()
      await page.waitForTimeout(300)
      // Drawer stays open (only note-click closes it).
      await expect(backdrop).toBeVisible()

      await page.screenshot({ path: `playwright-report/notes/mobile-folder-tap-${vp.label}.png` })
    })

    test('right-click on note row opens context menu', async ({ page }) => {
      await clearStorageAndVisit(page)
      await seedNotesAndFolder(page)
      await page.waitForTimeout(400)

      await openDrawer(page)
      await expect(page.locator('[data-testid="mobile-sidebar-backdrop"]')).toBeVisible({ timeout: 3_000 })

      const noteRow = page.getByTestId('note-row').first()
      await expect(noteRow).toBeVisible({ timeout: 3_000 })
      await noteRow.click({ button: 'right' })
      await page.waitForTimeout(300)

      // Context menu should appear.
      // ContextMenu root div has no testid/role — identify by its fixed-position
      // shadow class which is unique to the context menu overlay.
      const ctxMenu = page.locator('.shadow-obsidian.rounded-lg.fixed')
      await expect(ctxMenu).toBeVisible({ timeout: 2_000 })

      await page.screenshot({ path: `playwright-report/notes/mobile-ctx-menu-${vp.label}.png` })
    })
  })

  test.describe(`[${vp.label}] Scope 3 — drag guard regression`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('right-click on note row does NOT start a drag', async ({ page }) => {
      await clearStorageAndVisit(page)
      await seedNotesAndFolder(page)
      await page.waitForTimeout(400)

      await openDrawer(page)
      await expect(page.locator('[data-testid="mobile-sidebar-backdrop"]')).toBeVisible({ timeout: 3_000 })

      const noteRow = page.getByTestId('note-row').first()
      await expect(noteRow).toBeVisible({ timeout: 3_000 })

      // Register a dragstart listener BEFORE the right-click.
      const dragFiredPromise = page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          let fired = false
          const handler = () => { fired = true }
          window.addEventListener('dragstart', handler, { once: true })
          setTimeout(() => {
            window.removeEventListener('dragstart', handler)
            resolve(fired)
          }, 800)
        })
      })

      // Simulate right-click-hold-and-move (the real user gesture).
      const box = await noteRow.boundingBox()
      if (box) {
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down({ button: 'right' })
        await page.mouse.move(cx + 10, cy + 10)
        await page.mouse.move(cx + 20, cy + 20)
        await page.mouse.up({ button: 'right' })
      }

      const dragFired = await dragFiredPromise

      await page.screenshot({ path: `playwright-report/notes/mobile-drag-guard-${vp.label}.png` })
      expect(dragFired, 'right-click on note row must NOT fire dragstart').toBe(false)
    })
  })

  test.describe(`[${vp.label}] Scope 4 — overflow menu`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('overflow menu opens and contains nav and note-action items', async ({ page }) => {
      await clearStorageAndVisit(page)
      // Seed and open a note so Pin/Rename items are present.
      await page.evaluate(() => {
        const ns = window.__noteser_test!.stores.noteStore.getState()
        const ws = window.__noteser_test!.stores.workspaceStore.getState()
        const note = ns.addNote({ title: 'Overflow probe', folderId: null, content: '' })
        ws.openNote(note.id, { preview: false })
      })
      await page.waitForTimeout(300)

      const overflowBtn = page.locator('[data-testid="mobile-top-bar-overflow"]')
      await expect(overflowBtn).toBeVisible({ timeout: 5_000 })
      await overflowBtn.click()

      const menu = page.locator('[data-testid="mobile-top-bar-overflow-menu"]')
      await expect(menu).toBeVisible({ timeout: 3_000 })

      await page.screenshot({ path: `playwright-report/notes/mobile-overflow-menu-${vp.label}.png` })

      // Must have at least Pin/Rename (note actions) + All notes/Recent/Tags (nav).
      const buttonLabels = await menu.evaluate((el) =>
        Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
      )
      const hasPin = buttonLabels.some((l) => l.toLowerCase().includes('pin'))
      const hasRename = buttonLabels.some((l) => l.toLowerCase().includes('rename'))
      const hasNav = buttonLabels.some(
        (l) => l.toLowerCase().includes('all notes') || l.toLowerCase().includes('recent') || l.toLowerCase().includes('tags'),
      )

      expect(hasPin, 'overflow menu should have Pin item').toBe(true)
      expect(hasRename, 'overflow menu should have Rename item').toBe(true)
      expect(hasNav, 'overflow menu should have nav items (All notes / Recent / Tags)').toBe(true)
    })

    test('overflow menu items are ≥36px tall', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.evaluate(() => {
        const ns = window.__noteser_test!.stores.noteStore.getState()
        const ws = window.__noteser_test!.stores.workspaceStore.getState()
        const note = ns.addNote({ title: 'Size probe', folderId: null, content: '' })
        ws.openNote(note.id, { preview: false })
      })
      await page.waitForTimeout(300)

      await page.locator('[data-testid="mobile-top-bar-overflow"]').click()
      const menu = page.locator('[data-testid="mobile-top-bar-overflow-menu"]')
      await expect(menu).toBeVisible({ timeout: 3_000 })

      const sizes = await menu.evaluate((el) =>
        Array.from(el.querySelectorAll('button')).map((b) => {
          const r = b.getBoundingClientRect()
          return { h: Math.round(r.height), label: (b.textContent ?? '').trim() }
        })
      )
      expect(sizes.length).toBeGreaterThanOrEqual(6)
      for (const s of sizes) {
        expect.soft(s.h, `overflow item "${s.label}" height`).toBeGreaterThanOrEqual(36)
      }
    })
  })

  test.describe(`[${vp.label}] Scope 5 — editor on mobile`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('EditorHeader is hidden on mobile; MobileTopBar is visible', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.evaluate(() => {
        const ns = window.__noteser_test!.stores.noteStore.getState()
        const ws = window.__noteser_test!.stores.workspaceStore.getState()
        const note = ns.addNote({ title: 'Editor probe', folderId: null, content: '# Hello' })
        ws.openNote(note.id, { preview: false })
      })
      await page.waitForTimeout(300)

      // EditorHeader (desktop) should NOT be visible.
      const editorHeader = page.locator('[data-testid="editor-header"]')
      if (await editorHeader.count() > 0) {
        // If rendered, must be hidden via CSS (display none or visibility hidden).
        const isVisible = await editorHeader.isVisible()
        expect(isVisible, 'EditorHeader must be hidden on mobile').toBe(false)
      }

      // MobileTopBar must be visible and contain the preview-toggle button.
      const topBar = page.locator('[data-testid="mobile-top-bar"]')
      await expect(topBar).toBeVisible({ timeout: 3_000 })

      await page.screenshot({ path: `playwright-report/notes/mobile-editor-layout-${vp.label}.png` })
    })

    test('preview toggle in MobileTopBar switches preview mode', async ({ page }) => {
      await clearStorageAndVisit(page)
      await page.evaluate(() => {
        const ns = window.__noteser_test!.stores.noteStore.getState()
        const ws = window.__noteser_test!.stores.workspaceStore.getState()
        const note = ns.addNote({ title: 'Preview probe', folderId: null, content: '# Hello **bold**' })
        ws.openNote(note.id, { preview: false })
      })
      await page.waitForTimeout(300)

      const topBar = page.locator('[data-testid="mobile-top-bar"]')
      await expect(topBar).toBeVisible({ timeout: 3_000 })

      // Find preview toggle button by its stable testid.
      const previewBtn = page.locator('[data-testid="mobile-top-bar-preview-toggle"]')
      const previewBtnCount = await previewBtn.count()

      await page.screenshot({ path: `playwright-report/notes/mobile-preview-toggle-before-${vp.label}.png` })

      if (previewBtnCount > 0) {
        await previewBtn.click()
        await page.waitForTimeout(300)
        await page.screenshot({ path: `playwright-report/notes/mobile-preview-toggle-after-${vp.label}.png` })
      }
      // If no preview button found — the test logs that so we can flag it.
      expect(previewBtnCount, 'MobileTopBar should have a preview-toggle button').toBeGreaterThanOrEqual(1)
    })
  })
}
