import { test, expect } from '@playwright/test'

// Mobile formatting toolbar — Obsidian-mobile parity bar:
// Undo / Redo / [[Wikilink]] / Template / #Tag / Attach / Heading / Bold,
// plus a separated keyboard-dismiss pill on the right. Verifies the strip
// is mobile-only and that the action buttons transform the document the
// same way Obsidian's mobile bar does.

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

// Skipped (2026-05-30): MobileFormattingToolbar render-site removed from
// EditorContent per Jon — the iOS Safari input-accessory pill made our own
// bar feel redundant. Component file remains for possible future re-enable.
test.describe.skip('mobile viewport', () => {
  test.use(MOBILE_VIEWPORT)

  test('toolbar renders below the editor on mobile with the Obsidian-parity button set', async ({ page }) => {
    await seedNote(page, 'hello')
    await expect(page.getByTestId('mobile-formatting-toolbar')).toBeVisible()
    for (const id of [
      'format-undo', 'format-redo', 'format-wikilink', 'format-template',
      'format-tag', 'format-attach', 'format-heading', 'format-bold',
      'format-dismiss-keyboard',
    ]) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
  })

  test('Bold button wraps the selection in **', async ({ page }) => {
    await seedNote(page, 'hello world')
    await selectAll(page)
    await page.getByTestId('format-bold').click()
    expect(await getDocContent(page)).toBe('**hello world**')
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

  test('Wikilink button inserts [[]] and parks the caret between the brackets', async ({ page }) => {
    await seedNote(page, '')
    await page.locator('.cm-content').click()
    await page.getByTestId('format-wikilink').click()
    expect(await getDocContent(page)).toBe('[[]]')
    // Cursor should sit between the brackets — typing now appends inside.
    await page.locator('.cm-content').pressSequentially('hi')
    expect(await getDocContent(page)).toBe('[[hi]]')
  })

  test('Tag button inserts a `#` at the caret', async ({ page }) => {
    await seedNote(page, '')
    await page.locator('.cm-content').click()
    await page.getByTestId('format-tag').click()
    expect(await getDocContent(page)).toBe('#')
  })

  test('Undo + Redo step through the CodeMirror history', async ({ page }) => {
    await seedNote(page, '')
    await page.locator('.cm-content').click()
    await page.locator('.cm-content').pressSequentially('alpha')
    expect(await getDocContent(page)).toBe('alpha')
    await page.getByTestId('format-undo').click()
    expect(await getDocContent(page)).toBe('')
    await page.getByTestId('format-redo').click()
    expect(await getDocContent(page)).toBe('alpha')
  })

  test('Template button opens the template-picker modal', async ({ page }) => {
    await seedNote(page, '')
    await page.getByTestId('format-template').click()
    // SettingsModal / TemplatesModal share the dialog role; rely on test-id
    // if available, otherwise fall back to role=dialog.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 4000 })
  })

  test('Dismiss-keyboard button blurs the CodeMirror surface', async ({ page }) => {
    await seedNote(page, 'hi')
    await page.locator('.cm-content').click()
    // Confirm focus is on the editor before pressing dismiss.
    const focusedBefore = await page.evaluate(() =>
      document.activeElement?.classList.contains('cm-content')
    )
    expect(focusedBefore).toBe(true)
    await page.getByTestId('format-dismiss-keyboard').click()
    const focusedAfter = await page.evaluate(() =>
      document.activeElement?.classList.contains('cm-content')
    )
    expect(focusedAfter).toBe(false)
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
