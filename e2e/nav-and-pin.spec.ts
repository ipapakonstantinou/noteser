import { test, expect, type Page } from '@playwright/test'

// End-to-end coverage for the two note-navigation features:
//   1. Double-click a sidebar note → PINNED (non-italic) tab; single-click
//      → preview (italic) tab; right-click → Rename still works.
//   2. Back / Forward history (header arrows + Alt+←/→) walks A→B→C.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Suppress the first-run Welcome tab — without this, page.tsx opens
    // a `welcome`-kind tab on hydration and `activeTabTitle` lands on
    // "Welcome" instead of the just-clicked note (the active-tab strip
    // selector picks the tab marked with `border-t-obsidianAccentPurple`).
    //
    // Also persist sidebarGroups at v3 with the Files panel active so the
    // FolderTree mounts. Without an explicit v3 record, the settingsStore
    // migration ladder (v0→v3) treats this as a legacy install with no
    // pinned panels and collapses the sidebar to a single Calendar-only
    // group — the note rows never render and the test times out trying
    // to find them.
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: {
          onboardingShown: true,
          sidebarGroups: [
            { id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false },
          ],
        },
        version: 3,
      }))
    } catch { /* ignore */ }
  })
})

// Seed four root notes via the exposed test hook and return their ids.
async function seedNotes(page: Page): Promise<{ A: string; B: string; C: string; D: string }> {
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  return await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const A = ns.addNote({ title: 'Alpha', content: '# Alpha', folderId: null }).id
    const B = ns.addNote({ title: 'Beta', content: '# Beta', folderId: null }).id
    const C = ns.addNote({ title: 'Gamma', content: '# Gamma', folderId: null }).id
    const D = ns.addNote({ title: 'Delta', content: '# Delta', folderId: null }).id
    return { A, B, C, D }
  })
}

const noteRow = (page: Page, id: string) => page.locator(`[data-testid="note-row"][data-note-id="${id}"]`)
const activeTabTitle = (page: Page) =>
  page.locator('.border-t-obsidianAccentPurple span.truncate').first()

// Programmatic single click on a note row. We call HTMLElement.click()
// directly via evaluate() instead of `Locator.click()` / `page.mouse.click()`.
// Background: every note row is rendered with the HTML `draggable` attribute
// so the user can drag-and-drop a note between folders. In current
// Chromium (Playwright 1.60 / chromium-1223), the synthesised mouse-event
// sequence Playwright issues for a single click on a `draggable=true`
// element is consistently swallowed without emitting a `click` event —
// only the subsequent click in a tight pair fires. That breaks every
// single-click assertion below even though the same code path works fine
// for real users (whose hardware doesn't trip the same drag heuristic).
// Calling element.click() bypasses the mouse-event simulation and
// dispatches a real, bubbling `click` event from the row, which is what
// the React handler in FolderTree listens for. See
// https://github.com/microsoft/playwright/issues/12298 (and the linked
// Chromium tickets) for the underlying CDP behaviour.
async function singleClickRow(page: Page, id: string) {
  await page.evaluate((noteId) => {
    const el = document.querySelector(
      `[data-testid="note-row"][data-note-id="${noteId}"]`,
    ) as HTMLElement | null
    if (!el) throw new Error(`note row ${noteId} not found`)
    el.click()
  }, id)
}

// Drive TWO physically-separate clicks on a row, `gapMs` apart, exercising
// the self-detected double-click path in handleNoteClick. Each click is
// dispatched as a real bubbling event on the row element for the same
// draggable-suppression reason as `singleClickRow` above. The first click
// arms FolderTree's preview timer; the second click within DOUBLE_CLICK_MS
// (350ms) cancels that timer and pins instead. A `Locator.dblclick()`
// would fire click+click+dblclick within a single millisecond, which the
// happy path handles but is NOT the user-flow that broke (see the
// regression cases below).
async function twoRealClicks(page: Page, id: string, gapMs: number) {
  await singleClickRow(page, id)
  await page.waitForTimeout(gapMs)
  await singleClickRow(page, id)
}

const noteTabCount = (page: Page) =>
  page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    return ws.panes.flatMap(p => p.tabs).filter((t: { kind: string }) => t.kind === 'note').length
  })

test('single-click opens a preview (italic) tab; double-click pins it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  // Single click → preview tab (italic title in the tab strip). We use
  // the singleClickRow helper instead of `noteRow.click()` because the
  // row is `draggable=true` and Chromium swallows the first synthesised
  // click on draggable elements — see the helper comment.
  await singleClickRow(page, A)
  const title = activeTabTitle(page)
  await expect(title).toHaveText('Alpha')
  await expect(title).toHaveClass(/italic/)

  // Double click → promotes to pinned (non-italic), still a single tab.
  // `Locator.dblclick()` IS reliable on draggable rows in this Chromium
  // build (it synthesises a click+click+dblclick burst in one tick,
  // which the drag heuristic does not suppress), so we keep it here.
  await noteRow(page, A).dblclick()
  await expect(title).toHaveText('Alpha')
  await expect(title).not.toHaveClass(/italic/)

  // Confirm in store: single note tab, not preview.
  const state = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const noteTabs = ws.panes.flatMap(p => p.tabs).filter(t => t.kind === 'note')
    return { count: noteTabs.length, preview: (noteTabs[0] as { isPreview?: boolean }).isPreview }
  })
  expect(state.count).toBe(1)
  expect(state.preview).toBe(false)
})

test('double-clicking a fresh note opens it pinned directly (no preview flash persists)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { B } = await seedNotes(page)

  await noteRow(page, B).dblclick()
  const title = activeTabTitle(page)
  await expect(title).toHaveText('Beta')
  await expect(title).not.toHaveClass(/italic/)
})

test('right-click → Rename still works after the double-click change', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  await noteRow(page, A).click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  // Click the Rename item.
  await page.getByRole('button', { name: 'Rename' }).click()
  // An inline edit input should appear within the row; type a new name.
  const input = noteRow(page, A).locator('input')
  await expect(input).toBeVisible()
  await input.fill('Alpha Renamed')
  await input.press('Enter')

  const newTitle = await page.evaluate((id) => {
    return window.__noteser_test!.stores.noteStore.getState().notes.find(n => n.id === id)?.title
  }, A)
  expect(newTitle).toBe('Alpha Renamed')
})

test('Back / Forward header arrows walk A → B → C', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
  await expect(back).toBeEnabled()

  await back.click()
  await expect(title).toHaveText('Beta')
  await back.click()
  await expect(title).toHaveText('Alpha')
  await expect(back).toBeDisabled()

  await fwd.click()
  await expect(title).toHaveText('Beta')
  await fwd.click()
  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
})

test('Alt+Left / Alt+Right navigate history', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const title = activeTabTitle(page)
  await expect(title).toHaveText('Gamma')

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(title).toHaveText('Beta')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(title).toHaveText('Alpha')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(title).toHaveText('Beta')
})

test('navigating back then opening a new note truncates forward history', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await back.click() // B
  await back.click() // A
  await expect(title).toHaveText('Alpha')
  await expect(fwd).toBeEnabled()

  // Open C fresh — should truncate the B,C forward branch.
  await noteRow(page, C).dblclick()
  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
  await back.click()
  await expect(title).toHaveText('Alpha')
})

// ── Realistic regression tests (the bugs the happy-path missed) ────────────

test('REGRESSION: two real clicks (no native dblclick) still PIN the tab', async ({ page }) => {
  // Locator.dblclick() fires click+click+dblclick in <1ms, so the old
  // 200ms-timer + native-dblclick scheme happened to work. A real user's
  // two clicks land ~100-300ms apart and the browser often emits NO
  // dblclick — the tab then stuck as a replaceable preview ("double click
  // is not working"). The handler now self-detects the double-click.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B } = await seedNotes(page)

  await twoRealClicks(page, A, 120)
  await page.waitForTimeout(450)

  const title = activeTabTitle(page)
  await expect(title).toHaveText('Alpha')
  // PINNED — not italic/preview.
  await expect(title).not.toHaveClass(/italic/)

  // Single-click a DIFFERENT note: a preview tab would be replaced; the
  // pinned Alpha must persist. Use singleClickRow for the same draggable
  // suppression reason as above.
  await singleClickRow(page, B)
  await page.waitForTimeout(450)
  expect(await noteTabCount(page)).toBe(2)
  const stillThere = await page.evaluate((id) => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    return ws.panes.flatMap(p => p.tabs).some((t) => t.kind === 'note' && t.noteId === id)
  }, A)
  expect(stillThere).toBe(true)
})

test('REGRESSION: deliberate slow double-click (250ms apart) still pins', async ({ page }) => {
  // 250ms is well past the old 200ms preview timer — the first click would
  // have opened a preview before the second arrived. Self-detection within
  // the 350ms window still pins.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  await twoRealClicks(page, A, 250)
  await page.waitForTimeout(450)

  const isPreview = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
    return tab && tab.kind === 'note' ? tab.isPreview : null
  })
  expect(isPreview).toBe(false)
})

test('REGRESSION: two clicks 600ms apart are NOT a double-click (stays preview)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  await twoRealClicks(page, A, 600)
  await page.waitForTimeout(450)

  const isPreview = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
    return tab && tab.kind === 'note' ? tab.isPreview : null
  })
  // Two well-separated clicks are two single clicks → still a preview tab.
  expect(isPreview).toBe(true)
})

test('REGRESSION: Back/Forward through SINGLE-CLICK history does not pile up tabs', async ({ page }) => {
  // The "arrows behaving weird — going left and right" report. Single-click
  // opens preview tabs that replace each other, so visited notes have no
  // tab of their own. The old navigateInPane spawned a NEW pinned tab per
  // Back/Forward press, filling the strip and jumping the active highlight
  // around. Navigation must reuse the one preview tab.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  // Use singleClickRow (DOM `.click()`) instead of `noteRow.click()`:
  // Playwright's synthesised mouse click is swallowed on draggable rows
  // in this Chromium build, so the first preview tab never opens and
  // `noteTabCount` stays at 0. See helper comment for details.
  await singleClickRow(page, A); await page.waitForTimeout(450)
  await singleClickRow(page, B); await page.waitForTimeout(450)
  await singleClickRow(page, C); await page.waitForTimeout(450)
  expect(await noteTabCount(page)).toBe(1)

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await back.click(); await page.waitForTimeout(150)
  await expect(title).toHaveText('Beta')
  expect(await noteTabCount(page)).toBe(1) // reused, not spawned

  await back.click(); await page.waitForTimeout(150)
  await expect(title).toHaveText('Alpha')
  expect(await noteTabCount(page)).toBe(1)

  await fwd.click(); await page.waitForTimeout(150)
  await expect(title).toHaveText('Beta')
  expect(await noteTabCount(page)).toBe(1)

  await fwd.click(); await page.waitForTimeout(150)
  await expect(title).toHaveText('Gamma')
  expect(await noteTabCount(page)).toBe(1)
})

test('REGRESSION: each arrow press moves exactly one step and lands on the right note', async ({ page }) => {
  // Task sequence: open A,B,C; Back→B, Back→A, Forward→B; open D from
  // sidebar (forward drops); Back→B, and confirm no bounce.
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C, D } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await back.click(); await expect(title).toHaveText('Beta')
  await back.click(); await expect(title).toHaveText('Alpha')
  await fwd.click(); await expect(title).toHaveText('Beta')

  // Open D from the sidebar mid-history — forward (Gamma) must drop.
  await noteRow(page, D).dblclick()
  await expect(title).toHaveText('Delta')
  await expect(fwd).toBeDisabled()

  // Back lands on Beta (the entry we were at), not bouncing.
  await back.click(); await expect(title).toHaveText('Beta')
  await back.click(); await expect(title).toHaveText('Alpha')
  await expect(back).toBeDisabled()
})

test('REGRESSION: Back/Forward buttons do not shift layout when they enable/disable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')

  const b1 = await back.boundingBox()
  const f1 = await fwd.boundingBox()
  // Navigating toggles enabled/disabled state; positions must not move.
  await back.click(); await page.waitForTimeout(150)
  const b2 = await back.boundingBox()
  const f2 = await fwd.boundingBox()

  expect(b2!.x).toBeCloseTo(b1!.x, 0)
  expect(b2!.y).toBeCloseTo(b1!.y, 0)
  expect(f2!.x).toBeCloseTo(f1!.x, 0)
  expect(f2!.y).toBeCloseTo(f1!.y, 0)
})
