import { test, expect } from '@playwright/test'

// Verify the dynamically-loaded react-syntax-highlighter actually renders
// when the user enters preview mode and the note contains a fenced code
// block. Guards against silent failure modes of `next/dynamic` —
// the build passes whether or not the chunk loads at runtime.

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

test('Prism highlighter loads + renders a fenced JS block in preview mode', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(true)
    const content = [
      '# code sample',
      '',
      '```javascript',
      'const x = 42',
      'console.log(x)',
      '```',
    ].join('\n')
    const note = hooks.stores.noteStore.getState().addNote({ title: 'PrismTest', content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(true)
  })
  // Preview overlay should mount. Wait for ReactMarkdown to render +
  // the dynamically-imported Prism chunk to load + execute.
  await expect(async () => {
    // react-syntax-highlighter renders a <code class="language-javascript">
    // wrapper inside a <pre> with the oneDark style. The `.token` class
    // is the most reliable signal that Prism actually highlighted —
    // the chunk loaded AND ran.
    const tokenCount = await page.locator('.token').count()
    expect(tokenCount).toBeGreaterThan(0)
  }).toPass({ timeout: 10_000 })

  // The note text should still be present.
  await expect(page.locator('text=const x = 42').first()).toBeVisible()
})
