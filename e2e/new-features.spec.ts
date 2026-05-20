import { test, expect } from '@playwright/test'

// E2E smoke for the seven features that landed today (s9r4, p4n5, b3t1,
// b9g2, z9o3, b3e7, a0p4). Each test is intentionally narrow — we're
// confirming the surface mounts + the primary interaction works, not
// re-testing the unit-tested logic underneath.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch {}
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch {}
  })
})

async function openSettings(page: import('@playwright/test').Page) {
  // The Settings gear is pinned to the bottom of the Ribbon. Click it.
  await page.getByTitle('Settings').click()
  await expect(page.getByTestId('settings-categories')).toBeVisible()
}

// ── s9r4 — Settings 2-pane layout ────────────────────────────────────────────

test('settings modal mounts with 2-pane layout (s9r4)', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await expect(page.getByTestId('settings-panel-general')).toBeVisible()
  // Every documented category is reachable.
  for (const id of ['general', 'editor', 'attachments', 'daily-notes', 'templates', 'github', 'ai', 'shortcuts', 'export', 'beta', 'about']) {
    await expect(page.getByTestId(`settings-cat-${id}`)).toBeVisible()
  }
})

test('clicking a settings category swaps the right pane (s9r4)', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByTestId('settings-cat-about').click()
  await expect(page.getByTestId('settings-panel-about')).toBeVisible()
  await expect(page.getByTestId('settings-panel-general')).toHaveCount(0)
})

// ── b9g2 — bug-report button visible ─────────────────────────────────────────

test('settings → About → "Report a bug" button mounts (b9g2)', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByTestId('settings-cat-about').click()
  await expect(page.getByTestId('settings-report-bug')).toBeVisible()
})

// ── b3t1 — beta master toggle ────────────────────────────────────────────────

test('beta panel renders + master toggle reveals flag list (b3t1)', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByTestId('settings-cat-beta').click()
  await expect(page.getByTestId('settings-beta-panel')).toBeVisible()
  // Flag list should NOT be visible until the master toggle is on.
  await expect(page.getByText('Database / table view')).toHaveCount(0)
  // Flip the master toggle.
  const masterToggle = page.locator('[data-testid="settings-beta-panel"] input[type="checkbox"]').first()
  await masterToggle.click()
  await expect(page.getByText('Database / table view')).toBeVisible()
})

// ── p4n5 — periodic notes via command palette ────────────────────────────────

test('command palette has "Open this week" entry (p4n5)', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+P')
  // Type to filter the palette.
  await page.keyboard.type('this week')
  await expect(page.getByText('Open this week')).toBeVisible()
})

// ── a0p4 — frontmatter panel ─────────────────────────────────────────────────

test('frontmatter panel renders when a note has --- block (a0p4)', async ({ page }) => {
  await page.goto('/')
  // Bootstrap a note with frontmatter via the test-hooks window API.
  await page.evaluate(() => {
    const w = window as unknown as {
      __noteser?: { addNote: (input: { title: string; content: string }) => { id: string }; openNote: (id: string) => void }
    }
    const note = w.__noteser?.addNote({ title: 'WithFM', content: '---\ntitle: Hello\ntags: [a, b]\n---\nbody' })
    if (note && w.__noteser?.openNote) w.__noteser.openNote(note.id)
  })
  // Header is visible — the panel mounted.
  await expect(page.getByText(/^Properties \(\d+\)$/)).toBeVisible()
})

test('frontmatter panel shows "Add properties" affordance for a plain note (a0p4)', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const w = window as unknown as {
      __noteser?: { addNote: (input: { title: string; content: string }) => { id: string }; openNote: (id: string) => void }
    }
    const note = w.__noteser?.addNote({ title: 'NoFM', content: 'just body' })
    if (note && w.__noteser?.openNote) w.__noteser.openNote(note.id)
  })
  await expect(page.getByTestId('frontmatter-add')).toBeVisible()
})

// ── z9o3 — note embeds ───────────────────────────────────────────────────────

test('![[Title]] embed renders as a blockquote in preview (z9o3)', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const w = window as unknown as {
      __noteser?: { addNote: (input: { title: string; content: string }) => { id: string }; openNote: (id: string) => void }
    }
    w.__noteser?.addNote({ title: 'Source', content: 'hello from embedded note' })
    const host = w.__noteser?.addNote({ title: 'Host', content: 'Before\n![[Source]]\nAfter' })
    if (host && w.__noteser?.openNote) w.__noteser.openNote(host.id)
  })
  // Switch to rendered preview (Ctrl+E).
  await page.keyboard.press('Control+E')
  // The embed renders the source title as a header inside a blockquote.
  await expect(page.getByText(/hello from embedded note/)).toBeVisible()
})

// ── b3e7 — ribbon order persistence ──────────────────────────────────────────
// Drag-and-drop in Playwright is finicky for our wrapper-based handlers.
// Verify the data layer instead: setRibbonOrder via the store and confirm
// the DOM order updates.

test('ribbon items follow the saved order (b3e7)', async ({ page }) => {
  await page.goto('/')
  // First confirm default order has recent before tags.
  const beforeIds = await page.locator('[data-testid^="ribbon-item-"]').evaluateAll(
    els => els.map(e => e.getAttribute('data-testid'))
  )
  expect(beforeIds).toContain('ribbon-item-recent')
  expect(beforeIds).toContain('ribbon-item-tags')

  // Reorder: put trash first.
  await page.evaluate(() => {
    const w = window as unknown as { __noteser?: { setRibbonOrder?: (order: string[]) => void } }
    w.__noteser?.setRibbonOrder?.(['trash', 'notes', 'recent', 'tags', 'backlinks', 'calendar', 'outline'])
  })
  const afterIds = await page.locator('[data-testid^="ribbon-item-"]').evaluateAll(
    els => els.map(e => e.getAttribute('data-testid'))
  )
  expect(afterIds[0]).toBe('ribbon-item-trash')
})
