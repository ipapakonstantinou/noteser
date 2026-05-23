import { test, expect } from '@playwright/test'

// Exploratory console-monitoring pass.
// Exercises core flows while watching for console errors.
// Specifically watches for the "empty string src" React warning and
// other console errors that might indicate regressions.

const IGNORED_PATTERNS = [
  // Next.js dev-mode HMR noise
  /\[Fast Refresh\]/,
  /webpack/i,
  /hot.*update/i,
]

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

test('no console errors during normal editor usage', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text()
      const ignored = IGNORED_PATTERNS.some(p => p.test(text))
      if (!ignored) consoleErrors.push(text)
    }
  })

  await page.goto('/')
  // Wait for hydration
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )

  // Create a note and open it
  await page.evaluate(async () => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: object) => { id: string } } }
          workspaceStore: { getState(): { openNote: (id: string, opt: object) => void } }
          uiStore: { getState(): { setPreviewMode: (v: boolean) => void } }
          settingsStore: { getState(): { setNotesOpenInPreviewMode: (v: boolean) => void } }
        }
      }
    }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    hooks.stores.uiStore.getState().setPreviewMode(false)
    const note = hooks.stores.noteStore.getState().addNote({
      title: 'Console test',
      content: 'Hello world\n\n# Heading\n\n**bold** _italic_\n\n- [ ] task\n\n#tag1 #tag2',
    })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  })

  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })

  // Type some text
  await page.locator('.cm-content').click()
  await page.keyboard.type(' extra text')

  // Toggle preview mode
  await page.keyboard.press('Control+e')
  await page.waitForTimeout(500)

  // Toggle back
  await page.keyboard.press('Control+e')
  await page.waitForTimeout(300)

  // Open search
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+f')
  await expect(page.locator('.cm-panel.cm-search')).toBeVisible({ timeout: 3000 })
  await page.keyboard.press('Escape')

  // Create a second note and switch between them
  const noteId2 = await page.evaluate(async () => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: object) => { id: string } } }
          workspaceStore: { getState(): { openNote: (id: string, opt: object) => void } }
        }
      }
    }).__noteser_test
    const note2 = hooks.stores.noteStore.getState().addNote({
      title: 'Second note',
      content: 'Second note content',
    })
    hooks.stores.workspaceStore.getState().openNote(note2.id, { preview: false })
    return note2.id
  })
  void noteId2
  await page.waitForTimeout(500)

  // Check for the specific avatar empty-src warning
  const avatarWarning = consoleErrors.find(e =>
    e.includes('empty string') && e.includes('src')
  )
  expect(avatarWarning, `Avatar empty-src warning fired: ${avatarWarning}`).toBeUndefined()

  // Check for React rendering errors
  const reactErrors = consoleErrors.filter(e =>
    e.includes('Warning:') || e.includes('Error:') || e.includes('Uncaught')
  )
  expect(reactErrors, `Console errors found: ${reactErrors.join('\n')}`).toHaveLength(0)
})

test('no console errors during Ctrl+K quick switcher flow', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text()
      const ignored = IGNORED_PATTERNS.some(p => p.test(text))
      if (!ignored) consoleErrors.push(text)
    }
  })

  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )

  // Wait for sidebar to appear and create notes via test hooks
  await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 10000 })

  await page.evaluate(async () => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: object) => { id: string } } }
          settingsStore: { getState(): { setNotesOpenInPreviewMode: (v: boolean) => void } }
        }
      }
    }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    hooks.stores.noteStore.getState().addNote({ title: 'Alpha Note', content: 'alpha content' })
    hooks.stores.noteStore.getState().addNote({ title: 'Beta Note', content: 'beta content' })
  })

  // Open quick switcher — Ctrl+K
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('search-input')).toBeVisible({ timeout: 3000 })
  await page.keyboard.type('Alpha')
  await page.waitForTimeout(300)

  // Close with escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const avatarWarning = consoleErrors.find(e =>
    e.includes('empty string') && e.includes('src')
  )
  expect(avatarWarning, `Avatar empty-src warning fired: ${avatarWarning}`).toBeUndefined()
})
