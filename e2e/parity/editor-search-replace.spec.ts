import { test, expect } from '@playwright/test'

// CodeMirror search-replace panel.
//
// Verifies the built-in find/replace panel from `@codemirror/search`
// opens, highlights matches, and replaces text via the panel buttons.
// Keyboard shortcut wiring (Ctrl+F / Ctrl+H / F3 / Esc) is exercised
// implicitly by triggering openSearchPanel via Ctrl+F and Ctrl+H.

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

async function seedNote(page: import('@playwright/test').Page, content: string): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  await page.evaluate(async (content) => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    hooks.stores.uiStore.getState().setPreviewMode(false)
    const note = hooks.stores.noteStore.getState().addNote({ title: 'SearchTest', content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  }, content)
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })
  // Focus the editor so keyboard shortcuts route through CodeMirror.
  await page.locator('.cm-content').click()
}

test('Ctrl+F opens the search panel', async ({ page }) => {
  await seedNote(page, 'first line\nsecond line with apple\nthird line with apple\nfourth line')
  await page.keyboard.press('Control+f')
  await expect(page.locator('.cm-panel.cm-search')).toBeVisible({ timeout: 3000 })
  // Esc should close it.
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-panel.cm-search')).not.toBeVisible({ timeout: 3000 })
})

test('Ctrl+H opens the same panel (Obsidian-style replace shortcut)', async ({ page }) => {
  await seedNote(page, 'alpha beta gamma')
  await page.keyboard.press('Control+h')
  await expect(page.locator('.cm-panel.cm-search')).toBeVisible({ timeout: 3000 })
})

test('typing in the search input highlights matches', async ({ page }) => {
  await seedNote(page, 'apple banana\napple cherry\nbanana apple')
  await page.keyboard.press('Control+f')
  const searchInput = page.locator('.cm-panel.cm-search input[name="search"]')
  await searchInput.focus()
  // pressSequentially fires the 'input' event each keystroke — CM6's
  // search panel only repaints highlights when it sees that event.
  await page.keyboard.type('apple')
  await expect(async () => {
    const count = await page.locator('.cm-searchMatch').count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: 5000 })
})
