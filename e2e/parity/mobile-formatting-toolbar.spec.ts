import { test, expect } from '@playwright/test'

// Mobile formatting toolbar (Bold / Italic / Heading / Bullet / Task).
// Verifies the strip is mobile-only and that each button transforms
// the document the way Obsidian's mobile toolbar does.

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

// Avoid `devices['iPhone 13']` — it carries defaultBrowserType:'webkit'
// which Playwright forbids inside a describe.use(). Set viewport +
// touch + isMobile inline instead; that's all the toolbar logic
// actually cares about (it gates on a Tailwind `md:hidden` class which
// triggers at <768px viewport width).
const MOBILE_VIEWPORT = { viewport: { width: 390, height: 844 } }

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
    const note = hooks.stores.noteStore.getState().addNote({ title: 'FmtTest', content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  }, content)
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })
  // Dismiss the Next.js dev overlay if it intercepts clicks. Sets
  // pointer-events: none so the buttons below are reachable even when
  // the overlay portal is open (HMR / build indicators).
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
}

// Helper to read the current editor doc content via the test hooks.
async function getDocContent(page: import('@playwright/test').Page): Promise<string> {
  return await page.evaluate(() => {
    const el = document.querySelector('.cm-content') as HTMLElement | null
    if (!el) return ''
    // CodeMirror represents each line as a `.cm-line` child. Join them
    // with newlines to reconstruct the doc.
    const lines = Array.from(el.querySelectorAll('.cm-line')).map(l => l.textContent ?? '')
    return lines.join('\n')
  })
}

// Place the selection over the given text range using the test hooks-
// less path: just type the text fresh and select-all via CodeMirror.
async function selectAll(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
}

test.describe('mobile viewport', () => {
  test.use(MOBILE_VIEWPORT)

  test('toolbar renders below the editor on mobile', async ({ page }) => {
    await seedNote(page, 'hello')
    await expect(page.getByTestId('mobile-formatting-toolbar')).toBeVisible()
    await expect(page.getByTestId('format-bold')).toBeVisible()
    await expect(page.getByTestId('format-italic')).toBeVisible()
    await expect(page.getByTestId('format-heading')).toBeVisible()
    await expect(page.getByTestId('format-bullet')).toBeVisible()
    await expect(page.getByTestId('format-task')).toBeVisible()
  })

  test('Bold button wraps the selection in **', async ({ page }) => {
    await seedNote(page, 'hello world')
    await selectAll(page)
    await page.getByTestId('format-bold').click()
    expect(await getDocContent(page)).toBe('**hello world**')
  })

  test('Italic button wraps the selection in _', async ({ page }) => {
    await seedNote(page, 'hello world')
    await selectAll(page)
    await page.getByTestId('format-italic').click()
    expect(await getDocContent(page)).toBe('_hello world_')
  })

  test('Heading button cycles # / ## / ### / plain', async ({ page }) => {
    await seedNote(page, 'title')
    await page.locator('.cm-content').click()
    await page.getByTestId('format-heading').click()
    expect(await getDocContent(page)).toBe('# title')
    await page.getByTestId('format-heading').click()
    expect(await getDocContent(page)).toBe('## title')
    await page.getByTestId('format-heading').click()
    expect(await getDocContent(page)).toBe('### title')
    await page.getByTestId('format-heading').click()
    expect(await getDocContent(page)).toBe('title')
  })

  test('Bullet button toggles `- ` prefix on each selected line', async ({ page }) => {
    await seedNote(page, 'first\nsecond')
    await selectAll(page)
    await page.getByTestId('format-bullet').click()
    expect(await getDocContent(page)).toBe('- first\n- second')
    await selectAll(page)
    await page.getByTestId('format-bullet').click()
    expect(await getDocContent(page)).toBe('first\nsecond')
  })

  test('Task button toggles `- [ ] ` prefix on each selected line', async ({ page }) => {
    await seedNote(page, 'todo')
    await page.locator('.cm-content').click()
    await page.getByTestId('format-task').click()
    expect(await getDocContent(page)).toBe('- [ ] todo')
  })
})

test.describe('desktop viewport', () => {
  test('toolbar is NOT visible on desktop', async ({ page }) => {
    await seedNote(page, 'hello')
    // The `md:hidden` Tailwind utility collapses the toolbar at
    // ≥768px. The element may exist in the DOM but not be visible.
    await expect(page.getByTestId('mobile-formatting-toolbar')).not.toBeVisible()
  })
})
