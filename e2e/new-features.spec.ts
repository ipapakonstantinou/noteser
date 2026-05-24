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
    // Suppress the first-run onboarding modal — it blocks other interactions
    // by default. Individual tests that need to exercise onboarding can clear
    // this key explicitly.
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch {}
  })
})

async function openSettings(page: import('@playwright/test').Page) {
  // Open via the Ctrl+, shortcut rather than clicking the ribbon Settings
  // button. The button sits in the bottom-left corner, where the Next.js
  // dev-mode indicator overlay (`<nextjs-portal>`) also lives — in dev it
  // intercepts the click. The keyboard shortcut is a legitimate user path
  // and sidesteps the dev-overlay collision.
  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('settings-categories')).toBeVisible()
}

// Wait for React hydration to finish before touching the testHooks store
// bridge — `window.__noteser_test` is only defined after client mount, and
// the SSR HTML can be interactive before then (hydration race).
async function waitForHooks(page: import('@playwright/test').Page, timeout = 10_000) {
  await page.waitForFunction(
    () => typeof (window as unknown as { __noteser_test?: unknown }).__noteser_test !== 'undefined',
    undefined,
    { timeout },
  )
}

// Boots a note and opens it via the real Zustand stores exposed by testHooks.
async function seedAndOpen(page: import('@playwright/test').Page, title: string, content: string) {
  await waitForHooks(page)
  await page.evaluate(({ title, content }) => {
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
  }, { title, content })
}

// ── s9r4 — Settings 2-pane layout ────────────────────────────────────────────

test('settings modal mounts with 2-pane layout (s9r4)', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await expect(page.getByTestId('settings-panel-general')).toBeVisible()
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
  await expect(page.getByText('Database / table view')).toHaveCount(0)
  const masterToggle = page.locator('[data-testid="settings-beta-panel"] input[type="checkbox"]').first()
  await masterToggle.click()
  await expect(page.getByText('Database / table view')).toBeVisible()
})

// ── p4n5 — periodic notes via command palette ────────────────────────────────

test('command palette has "Open this week" entry (p4n5)', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+P')
  await page.keyboard.type('this week')
  await expect(page.getByText('Open this week')).toBeVisible()
})

// ── a0p4 — frontmatter panel ─────────────────────────────────────────────────

test('frontmatter panel renders when a note has --- block (a0p4)', async ({ page }) => {
  await page.goto('/')
  await seedAndOpen(page, 'WithFM', '---\ntitle: Hello\ntags: [a, b]\n---\nbody')
  await expect(page.getByText(/^Properties \(\d+\)$/)).toBeVisible()
})

test('frontmatter "Add properties" affordance for plain notes (a0p4)', async ({ page }) => {
  await page.goto('/')
  await seedAndOpen(page, 'NoFM', 'just body')
  await expect(page.getByTestId('frontmatter-add')).toBeVisible()
})

// ── z9o3 — note embeds ───────────────────────────────────────────────────────

test('![[Title]] embed renders as a blockquote in preview (z9o3)', async ({ page }) => {
  await page.goto('/')
  // The testHooks store bridge mounts during hydration; wait for it before
  // seeding (otherwise we lose a hydration race on the first evaluate).
  await waitForHooks(page)
  // Seed Source first so Host can resolve it.
  await page.evaluate(() => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: { title: string; content: string }) => { id: string } } }
          workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
          uiStore: { getState(): { setPreviewMode: (v: boolean) => void } }
        }
      }
    }).__noteser_test
    hooks.stores.noteStore.getState().addNote({ title: 'Source', content: 'hello from embedded note' })
    const host = hooks.stores.noteStore.getState().addNote({ title: 'Host', content: 'Before\n![[Source]]\nAfter' })
    hooks.stores.workspaceStore.getState().openNote(host.id, { preview: false })
    // Render the embed in rendered-preview. Set it deterministically via
    // the store rather than pressing Ctrl+E — notes open in preview by
    // default now, so a blind toggle would race the async default and could
    // land us back in edit mode.
    hooks.stores.uiStore.getState().setPreviewMode(true)
  })
  await expect(page.getByText(/hello from embedded note/)).toBeVisible()
})

// ── vsg1 — opening the Source control view with a configured repo doesn't crash ──
//
// Regression test for React error #185 (Maximum update depth exceeded). A
// non-memoised conflictTabs selector in GitHubView built a fresh array
// per render → useSyncExternalStore thought state changed every cycle →
// infinite loop. Only triggered when the SourceControlPanel was also
// mounted (which it is whenever the user is in the github view).
//
// GitHub moved out of the ribbon into the Source control sidebar tab
// (`sidebar-tab-source-control` → GitHubView). We seed a fake-but-shape-
// correct GitHub session into localStorage, open that sidebar tab, and
// assert nothing throws.

test('opening the Source control sidebar tab with a configured repo does not crash (vsg1)', async ({ page }) => {
  // Capture page errors BEFORE navigating — they'll fire during the
  // initial render and the post-click commit otherwise.
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await page.addInitScript(() => {
    try {
      window.localStorage.clear()
      window.localStorage.setItem('noteser-reset-version', '1')
      window.localStorage.setItem('noteser-github', JSON.stringify({
        state: {
          token: 'test-token',
          user: { login: 'me', avatar_url: '', id: 1, name: '' },
          syncRepo: { owner: 'me', name: 'vault', branch: 'main', isPrivate: false },
          lastSyncedAt: Date.now() - 60_000,
          lastCommitSha: 'abc1234',
          repoSyncStates: {},
        },
        version: 0,
      }))
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch {}
  })

  await page.goto('/')

  // GitHub now lives in the Source control sidebar tab (it left the ribbon
  // in the May-2026 redesign). Open that tab to mount GitHubView.
  const scTab = page.getByTestId('sidebar-tab-source-control')
  await expect(scTab).toBeVisible({ timeout: 5000 })

  await scTab.click()

  // Confirm the GitHub view actually mounted (source-control panel is
  // the new surface that used to be what tipped this over the edge).
  await expect(page.getByTestId('source-control-panel')).toBeVisible({ timeout: 5000 })

  // Wait a beat to give any latent loop time to throw.
  await page.waitForTimeout(1500)

  expect(pageErrors).toEqual([])
})

// ── b3e7 — ribbon order persistence ──────────────────────────────────────────

test('ribbon items follow the saved order (b3e7)', async ({ page }) => {
  await page.goto('/')
  // Wait for the ribbon to be mounted. After the May-2026 redesign the
  // ribbon holds quick-launch ACTION ids (new-note / daily-note /
  // command-palette / templates / random-note) — the old filter-mode ids
  // (notes/recent/tags/backlinks/calendar/outline/trash) were removed and
  // are silently dropped by resolveRibbonOrder.
  await expect(page.getByTestId('ribbon-item-new-note')).toBeVisible()
  const beforeIds = await page.locator('[data-testid^="ribbon-item-"]').evaluateAll(
    els => els.map(e => e.getAttribute('data-testid')),
  )
  expect(beforeIds).toContain('ribbon-item-templates')
  expect(beforeIds).toContain('ribbon-item-random-note')

  // Reorder via the store action exposed by testHooks: put random-note
  // first. (Stale ids in the saved order are dropped; known ids are kept.)
  await page.evaluate(() => {
    const hooks = (window as unknown as {
      __noteser_test: { stores: { settingsStore: { getState(): { setRibbonOrder: (order: string[]) => void } } } }
    }).__noteser_test
    hooks.stores.settingsStore.getState().setRibbonOrder([
      'random-note', 'new-note', 'daily-note', 'command-palette', 'templates',
    ])
  })

  await expect(page.locator('[data-testid^="ribbon-item-"]').first()).toHaveAttribute(
    'data-testid', 'ribbon-item-random-note',
  )
})
