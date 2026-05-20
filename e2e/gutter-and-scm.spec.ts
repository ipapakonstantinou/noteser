import { test, expect } from '@playwright/test'

// E2E smoke for the two features the user asked us to verify:
//   - editor gutter diff markers (109)
//   - Source Control tree-grouped panel (108)
//
// We don't drive a real sync (no GitHub credentials). Instead we
// stub the "last-pushed content" snapshot via the IDB layer our
// editor reads from, then assert the gutter renders the expected
// CSS classes for the diff. For Source Control we seed notes
// directly into noteStore with gitPath set so the panel groups
// them by folder.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch {}
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch {}
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch {}
  })
})

// ── 109 — editor gutter diff ─────────────────────────────────────────────────

// Shared test-hook shape — Playwright reaches into window.__noteser_test
// to seed state without driving the UI for every assertion.
type TestHooks = {
  stores: {
    noteStore: { getState(): {
      // addNote takes Partial<Note>; we widen to the keys our specs
      // use so TS doesn't reject gitPath/updatedAt overrides.
      addNote: (i: Partial<{
        title: string; content: string; gitPath: string | null; updatedAt: number
      }>) => { id: string }
    } }
    workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
    uiStore: { getState(): { setSidebarTab: (id: string) => void } }
    githubStore: { getState(): {
      setSyncRepo: (r: { owner: string; name: string; branch: string; isPrivate: boolean }) => void
      setSession: (token: string, user: { id: number; login: string; name: string | null; avatar_url: string }) => void
      recordSync: (sha: string) => void
    } }
  }
  lastPushedContent: {
    set: (noteId: string, content: string) => Promise<void>
  }
}

test('gutter shows green "added" marker when note has lines not in last-pushed', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test))
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    const note = hooks.stores.noteStore.getState().addNote({
      title: 'Gutter',
      content: 'first\nNEW LINE\nlast',
    })
    await hooks.lastPushedContent.set(note.id, 'first\nlast')
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })

  // Wait for the gutter to render at least one added marker. Use
  // attached + count rather than `toBeVisible` because the 3px-wide
  // CodeMirror gutter element trips Playwright's visibility check
  // even when the marker is painted correctly.
  await expect(async () => {
    const count = await page.locator('.cm-diff-added').count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: 5000 })
  expect(await page.locator('.cm-diff-added').count()).toBe(1)
})

test('gutter shows yellow "modified" marker when a line was replaced', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test))
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    const note = hooks.stores.noteStore.getState().addNote({
      title: 'GutterMod',
      // Baseline has "middle"; current replaces it with "MIDDLE-EDITED".
      content: 'first\nMIDDLE-EDITED\nlast',
    })
    await hooks.lastPushedContent.set(note.id, 'first\nmiddle\nlast')
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })

  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: 5000 })
})

test('gutter is clean when a note has no last-pushed snapshot (first-write case)', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test))
  await page.evaluate(() => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    const note = hooks.stores.noteStore.getState().addNote({
      title: 'Fresh',
      content: 'first\nsecond\nthird',
    })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })

  await page.waitForTimeout(500)
  await expect(page.locator('.cm-diff-added')).toHaveCount(0)
  await expect(page.locator('.cm-diff-modified')).toHaveCount(0)
})

// ── 108 — Source Control tree-grouped panel ───────────────────────────────────

test('source-control panel groups changes by folder', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test))

  // Seed four notes with explicit gitPath values so the panel
  // classifies them as "pending" (gitPath set + updatedAt newer than
  // the freshly-cleared lastSyncedAt).
  await page.evaluate(() => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    // Set a fake repo so the SCM panel renders the action toolbar
    // and the changes section.
    // GitHubView requires a logged-in user for the SCM body to mount.
    hooks.stores.githubStore.getState().setSession('fake-token', {
      id: 1, login: 'tester', name: 'Test', avatar_url: '',
    })
    hooks.stores.githubStore.getState().setSyncRepo({
      owner: 'me', name: 'vault', branch: 'main', isPrivate: false,
    })
    // Four pending notes — two in Notes/Weekly, one in Notes/Daily,
    // one at the root.
    const ns = hooks.stores.noteStore.getState()
    ns.addNote({ title: 'W11', content: 'week 11', gitPath: 'Notes/Weekly/2026-W11.md', updatedAt: Date.now() })
    ns.addNote({ title: 'W12', content: 'week 12', gitPath: 'Notes/Weekly/2026-W12.md', updatedAt: Date.now() })
    ns.addNote({ title: 'D20', content: 'daily 20', gitPath: 'Notes/Daily/2026-05-20.md', updatedAt: Date.now() })
    ns.addNote({ title: 'README', content: 'readme', gitPath: 'README.md', updatedAt: Date.now() })
    // Switch the sidebar to the source-control tab.
    hooks.stores.uiStore.getState().setSidebarTab('source-control')
  })

  await expect(page.getByTestId('source-control-panel')).toBeVisible({ timeout: 5000 })

  // Every seeded note should show up in the panel.
  await expect(page.getByText('2026-W11.md')).toBeVisible()
  await expect(page.getByText('2026-W12.md')).toBeVisible()
  await expect(page.getByText('2026-05-20.md')).toBeVisible()
  await expect(page.getByText('README.md')).toBeVisible()

  // The folder grouping puts a "Notes" + "Weekly" + "Daily" row in
  // the tree. Verify they all appear.
  await expect(page.getByText('Notes', { exact: true })).toBeVisible()
  await expect(page.getByText('Weekly', { exact: true })).toBeVisible()
  await expect(page.getByText('Daily', { exact: true })).toBeVisible()

  // Each leaf row carries a status badge — M (modified) is what
  // classifyPendingChanges picks for notes with an existing gitPath.
  // We expect at least one M badge per leaf.
  const mBadges = await page.getByTestId('source-control-badge-modified').count()
  expect(mBadges).toBeGreaterThanOrEqual(4)
})

test('source-control panel shows "clean" when no pending changes', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test))
  await page.evaluate(() => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    // GitHubView requires a logged-in user for the SCM body to mount.
    hooks.stores.githubStore.getState().setSession('fake-token', {
      id: 1, login: 'tester', name: 'Test', avatar_url: '',
    })
    hooks.stores.githubStore.getState().setSyncRepo({
      owner: 'me', name: 'vault', branch: 'main', isPrivate: false,
    })
    // Record a recent sync so any future-added notes would be "pending"
    // but since we haven't added any, total should be 0.
    hooks.stores.githubStore.getState().recordSync('sha-abc')
    hooks.stores.uiStore.getState().setSidebarTab('source-control')
  })

  await expect(page.getByTestId('source-control-panel')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('source-control-count')).toHaveText('clean')
})
