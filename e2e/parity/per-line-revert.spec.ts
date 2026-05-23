import { test, expect } from '@playwright/test'

// Per-line revert in the editor gutter (feature 109 extension).
//
// Tests that clicking a colored diff-gutter bar reverts that change-hunk
// back to the last-pushed baseline in a single transaction (undo restores it).
//
// BUG FOUND (2026-05-23): The CodeMirror obsidianTheme in
// CodeMirrorEditor.tsx contains `.cm-gutters: { display: none }`, which
// hides the entire gutter container. The diff-gutter bars are rendered in
// the DOM but have zero bounding rect (confirmed via getBoundingClientRect).
// This means:
//   1. The bars are INVISIBLE to users (`.cm-gutters` is display:none).
//   2. Clicks cannot land on the gutter — `page.mouse.click` at the
//      element's bounding rect clicks (0,0) because all rects are zeroed.
//   3. The per-line revert click handler in diffGutter.ts is dead code.
//
// Tests 1-4 below are marked failing to document this regression.
// Test 5 (cursor style) still passes — getComputedStyle works even on
// display:none elements, so that assertion is valid but misleading.

type TestHooks = {
  stores: {
    noteStore: { getState(): {
      addNote: (i: Partial<{
        title: string; content: string; gitPath: string | null; updatedAt: number
      }>) => { id: string }
    } }
    workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
    uiStore: { getState(): { setPreviewMode: (mode: boolean) => void } }
    settingsStore: { getState(): { setNotesOpenInPreviewMode: (v: boolean) => void } }
  }
  lastPushedContent: {
    set: (noteId: string, content: string) => Promise<void>
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch {}
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch {}
    // Skip onboarding so we land directly on the editor.
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 0,
      }))
    } catch {}
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedNoteWithBaseline(
  page: import('@playwright/test').Page,
  {
    local,
    baseline,
    title = 'RevertTest',
  }: { local: string; baseline: string; title?: string },
): Promise<string> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  const noteId = await page.evaluate(
    async ({ local, baseline, title }) => {
      const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
      // Settings default `notesOpenInPreviewMode` flips preview mode on
      // every openNote — must be cleared BEFORE openNote, otherwise the
      // async settingsStore import inside workspaceStore.openNote will
      // re-toggle preview mode and the overlay (`z-10 absolute inset-0`)
      // will intercept gutter clicks.
      hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
      hooks.stores.uiStore.getState().setPreviewMode(false)
      const note = hooks.stores.noteStore.getState().addNote({ title, content: local })
      await hooks.lastPushedContent.set(note.id, baseline)
      hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
      // Belt-and-suspenders: after openNote schedules its async preview
      // reset, force preview off one more time. Microtask flush via a
      // 0ms sleep lets the openNote-spawned promise settle first.
      await new Promise(r => setTimeout(r, 0))
      hooks.stores.uiStore.getState().setPreviewMode(false)
      return note.id
    },
    { local, baseline, title },
  )

  // Wait for the CodeMirror editor to be present.
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })

  // Wait for at least one diff marker to appear in the DOM (they exist
  // even though their parent .cm-gutters has display:none).
  await expect(async () => {
    const count =
      (await page.locator('.cm-diff-added').count()) +
      (await page.locator('.cm-diff-modified').count())
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: 8000 })

  return noteId
}

// Confirms the gutter container is hidden — the root cause of the click failures.
test('BUG: .cm-gutters container has display:none — diff bars are invisible', async ({ page }) => {
  await seedNoteWithBaseline(page, {
    local: 'first\nCHANGED\nlast',
    baseline: 'first\noriginal\nlast',
    title: 'GutterVisibility',
  })

  const guttersDisplay = await page.evaluate(() => {
    const gutters = document.querySelector('.cm-gutters') as HTMLElement | null
    return gutters ? window.getComputedStyle(gutters).display : 'NOT FOUND'
  })
  // This assertion documents the bug: display should be 'flex' (or 'block'),
  // not 'none'. Currently it IS 'none', so the test fails — intentionally.
  expect(guttersDisplay).not.toBe('none')
})

// ── Click-revert tests — all fail due to the display:none bug ─────────────────

test('yellow bar click reverts a modified line to its baseline content', async ({ page }) => {
  // local: "middle" replaced with "MIDDLE-EDITED"
  await seedNoteWithBaseline(page, {
    local: 'first\nMIDDLE-EDITED\nlast',
    baseline: 'first\nmiddle\nlast',
    title: 'RevertModified',
  })

  // Verify a modified marker is present in the DOM.
  await expect(page.locator('.cm-diff-modified').first()).toBeAttached()

  // Get the bounding rect — with display:none it will be (0,0,0,0).
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.cm-diff-modified') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  // rect will be {x:0, y:0} — clicking here goes to the viewport corner, not the gutter.
  if (!rect) throw new Error('.cm-diff-modified not found')
  await page.mouse.click(rect.x, rect.y)

  // After a working revert the marker should disappear.
  // Currently it stays because the click doesn't reach the gutter handler.
  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBe(0)
  }).toPass({ timeout: 5000 })

  const content = await page.locator('.cm-content').textContent()
  expect(content).toContain('middle')
  expect(content).not.toContain('MIDDLE-EDITED')
})

test('green bar click deletes an added line', async ({ page }) => {
  await seedNoteWithBaseline(page, {
    local: 'first\nNEW LINE\nlast',
    baseline: 'first\nlast',
    title: 'RevertAdded',
  })

  await expect(page.locator('.cm-diff-added').first()).toBeAttached()

  const rect = await page.evaluate(() => {
    const el = document.querySelector('.cm-diff-added') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!rect) throw new Error('.cm-diff-added not found')
  await page.mouse.click(rect.x, rect.y)

  await expect(async () => {
    const count = await page.locator('.cm-diff-added').count()
    expect(count).toBe(0)
  }).toPass({ timeout: 5000 })

  const content = await page.locator('.cm-content').textContent()
  expect(content).not.toContain('NEW LINE')
})

test('multi-line hunk reverts as a single unit — one click anywhere in the hunk', async ({
  page,
}) => {
  await seedNoteWithBaseline(page, {
    local: 'before\nLINE-A-EDITED\nLINE-B-EDITED\nafter',
    baseline: 'before\nline-a\nline-b\nafter',
    title: 'RevertMultiLine',
  })

  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBe(2)
  }).toPass({ timeout: 5000 })

  const rect = await page.evaluate(() => {
    const el = document.querySelector('.cm-diff-modified') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!rect) throw new Error('.cm-diff-modified not found')
  await page.mouse.click(rect.x, rect.y)

  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBe(0)
  }).toPass({ timeout: 5000 })

  const content = await page.locator('.cm-content').textContent()
  expect(content).toContain('line-a')
  expect(content).toContain('line-b')
  expect(content).not.toContain('LINE-A-EDITED')
  expect(content).not.toContain('LINE-B-EDITED')
})

test('Ctrl+Z after a revert restores the original (changed) content', async ({ page }) => {
  await seedNoteWithBaseline(page, {
    local: 'first\nCHANGED\nlast',
    baseline: 'first\noriginal\nlast',
    title: 'RevertUndo',
  })

  await expect(page.locator('.cm-diff-modified').first()).toBeAttached()

  const rect = await page.evaluate(() => {
    const el = document.querySelector('.cm-diff-modified') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!rect) throw new Error('.cm-diff-modified not found')
  await page.mouse.click(rect.x, rect.y)

  // Revert should clear the marker.
  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBe(0)
  }).toPass({ timeout: 5000 })

  // Undo restores the changed content.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+z')

  await expect(async () => {
    const count = await page.locator('.cm-diff-modified').count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: 5000 })

  const content = await page.locator('.cm-content').textContent()
  expect(content).toContain('CHANGED')
})

// ── Test 6 — cursor style (still passes, but irrelevant while gutter is hidden) ──

test('cursor shows pointer style on hover over a diff bar', async ({ page }) => {
  // NOTE: This test passes because getComputedStyle works even on
  // display:none elements. It does NOT mean the user can hover/click
  // the bar — the gutter is invisible. When the display:none bug is
  // fixed, this test remains valid.
  await seedNoteWithBaseline(page, {
    local: 'hello\nWORLD\nfoo',
    baseline: 'hello\nworld\nfoo',
    title: 'RevertCursor',
  })

  await expect(page.locator('.cm-diff-modified').first()).toBeAttached()

  const cursor = await page.locator('.cm-diff-modified').first().evaluate(
    (el) => window.getComputedStyle(el).cursor,
  )
  expect(cursor).toBe('pointer')
})
