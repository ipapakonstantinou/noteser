import { test, expect } from '@playwright/test'

// Markdown table insertion via Ctrl+Alt+T.
// Drops a 2x2 table template at the cursor and selects "Header 1" so
// the user can immediately overtype.

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

async function seedAndOpen(page: import('@playwright/test').Page, initialContent = ''): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  await page.evaluate(async (initialContent) => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    hooks.stores.uiStore.getState().setPreviewMode(false)
    const note = hooks.stores.noteStore.getState().addNote({ title: 'TableTest', content: initialContent })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  }, initialContent)
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
  await page.locator('.cm-content').click()
}

async function getDocContent(page: import('@playwright/test').Page): Promise<string> {
  return await page.evaluate(() => {
    const el = document.querySelector('.cm-content') as HTMLElement | null
    if (!el) return ''
    const lines = Array.from(el.querySelectorAll('.cm-line')).map(l => l.textContent ?? '')
    return lines.join('\n')
  })
}

test('Ctrl+Alt+T inserts a 2x2 table at the cursor', async ({ page }) => {
  await seedAndOpen(page, '')
  await page.keyboard.press('Control+Alt+t')
  const content = await getDocContent(page)
  expect(content).toContain('| Header 1 | Header 2 |')
  expect(content).toContain('| --- | --- |')
  expect(content).toContain('| Cell 1 | Cell 2 |')
  expect(content).toContain('| Cell 3 | Cell 4 |')
})

test('Selected "Header 1" is overwritten when the user types', async ({ page }) => {
  await seedAndOpen(page, '')
  await page.keyboard.press('Control+Alt+t')
  await page.keyboard.type('Name')
  const content = await getDocContent(page)
  // "Header 1" should now be "Name"; the rest of the table is intact.
  expect(content).toContain('| Name | Header 2 |')
})

test('On a non-empty line, the table is inserted on its own block', async ({ page }) => {
  await seedAndOpen(page, 'paragraph above')
  // Click at end of the existing line.
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Alt+t')
  const content = await getDocContent(page)
  // The existing paragraph should be preserved.
  expect(content).toContain('paragraph above')
  // Table is inserted below; assert it follows the paragraph.
  expect(content).toMatch(/paragraph above\s*\n\s*\n\s*\| Header 1/)
})
