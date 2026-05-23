import { test, expect } from '@playwright/test'

// Visual + computed-style verification that the accent color migrated
// from Obsidian purple to noteser blue. The token name
// `--obsidian-accent-purple` stays for back-compat, but the value
// at :root should resolve to a blue hsl now.

type TestHooks = {
  stores: {
    noteStore: { getState(): {
      addNote: (i: Partial<{ title: string; content: string }>) => { id: string }
    } }
    workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
    uiStore: { getState(): { setPreviewMode: (mode: boolean) => void } }
    settingsStore: { getState(): { setNotesOpenInPreviewMode: (v: boolean) => void } }
  }
}

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

test('--obsidian-accent-purple resolves to a blue hue (213°), not purple (254°)', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const accent = await page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--obsidian-accent-purple')
    return v.trim()
  })

  // Should resolve to hsl(213, 94%, 68%) — the new blue. Allow any
  // representation (hsl, rgb) — just check we're NOT in purple territory.
  // Easiest: convert to RGB via a temporary element and read its blue
  // channel.
  const rgb = await page.evaluate((value) => {
    const probe = document.createElement('div')
    probe.style.color = value
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    document.body.removeChild(probe)
    return computed
  }, accent)

  // computed.color is something like "rgb(96, 165, 250)". Parse it.
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  expect(m, `Expected accent to parse as rgb(...), got "${rgb}"`).not.toBeNull()
  if (!m) return
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3])

  // Blue: B > G > R, and B is dominant. This rules out purple (where
  // R is also high) and red/green/yellow/etc.
  expect(b, `Expected blue dominance, got rgb(${r}, ${g}, ${b})`).toBeGreaterThan(r)
  expect(b).toBeGreaterThan(g)
  expect(b - r).toBeGreaterThan(80) // Strong blue separation from red
})

test('screenshot: app renders with new blue accent', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    const note = hooks.stores.noteStore.getState().addNote({
      title: 'Theme preview',
      content: '# Heading\n\nA paragraph with **bold** and a #tag and a [[wikilink]].\n\n- list item\n- another item',
    })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  })
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })
  // Visual reference for the user — saved to playwright-report.
  await page.screenshot({
    path: 'playwright-report/notes/theme-blue-accent.png',
    fullPage: false,
  })
})
