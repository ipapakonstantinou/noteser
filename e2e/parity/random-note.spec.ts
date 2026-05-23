import { test, expect } from '@playwright/test'

// Random Note feature — ribbon button, keyboard shortcut (Alt+R),
// and command palette entry should all open a non-current note.

type TestHooks = {
  stores: {
    noteStore: { getState(): {
      addNote: (i: Partial<{ title: string; content: string }>) => { id: string }
      selectedNoteId: string | null
    } }
    workspaceStore: { getState(): { panes: { id: string; tabs: { id: string; noteId?: string }[] }[] } }
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

async function seedMany(page: import('@playwright/test').Page): Promise<string[]> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  const ids = await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    const ids: string[] = []
    for (const t of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
      ids.push(hooks.stores.noteStore.getState().addNote({ title: t, content: `# ${t}` }).id)
    }
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
    return ids
  })
  return ids
}

test('Alt+R opens a note', async ({ page }) => {
  await seedMany(page)
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
  await page.keyboard.press('Alt+r')
  // After Alt+R a note tab should be in the workspace.
  await expect(async () => {
    const openTabCount = await page.evaluate(() => {
      const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
      return hooks.stores.workspaceStore.getState().panes
        .flatMap(p => p.tabs).length
    })
    expect(openTabCount).toBeGreaterThan(0)
  }).toPass({ timeout: 3000 })
})

test('ribbon "Open a random note" button opens a note', async ({ page }) => {
  await seedMany(page)
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
  await page.getByRole('button', { name: /open a random note/i }).click()
  await expect(async () => {
    const openTabCount = await page.evaluate(() => {
      const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
      return hooks.stores.workspaceStore.getState().panes
        .flatMap(p => p.tabs).length
    })
    expect(openTabCount).toBeGreaterThan(0)
  }).toPass({ timeout: 3000 })
})

test('command palette → "random" runs the action', async ({ page }) => {
  await seedMany(page)
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
  await page.keyboard.press('Control+Shift+p')
  await expect(page.getByPlaceholder(/type a command/i).or(page.locator('input[type="text"]').first())).toBeVisible({ timeout: 3000 })
  await page.keyboard.type('random')
  await page.keyboard.press('Enter')
  await expect(async () => {
    const openTabCount = await page.evaluate(() => {
      const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
      return hooks.stores.workspaceStore.getState().panes
        .flatMap(p => p.tabs).length
    })
    expect(openTabCount).toBeGreaterThan(0)
  }).toPass({ timeout: 3000 })
})
