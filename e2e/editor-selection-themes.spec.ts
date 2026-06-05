import { test, expect, type Page } from '@playwright/test'
import { THEME_PRESETS } from '../src/utils/theme'

// Visual regression for `--obsidian-selection` across every built-in theme.
//
// The unit suite (src/__tests__/themeSelectionContrast.test.ts) pins the
// contrast ratio on the *token value*, but jsdom does not paint
// CodeMirror's `.cm-selectionLayer`. This spec mounts the real editor in
// each preset, selects a known paragraph, and snapshots the `.cm-editor`
// region. A future palette tweak that lands an invisible selection (the
// pre-2026-06-04 launch-week bug) fails CI on the diff instead of on user
// reports.

type TestHooks = {
  stores: {
    noteStore: {
      getState(): {
        addNote: (input: { folderId: string | null }) => { id: string }
        updateNote: (id: string, patch: { content: string }) => void
      }
    }
    workspaceStore: {
      getState(): { openNote: (id: string, opt: { preview: boolean }) => void }
    }
    uiStore: { getState(): { setPreviewMode: (mode: boolean) => void } }
    settingsStore: {
      getState(): { setNotesOpenInPreviewMode: (v: boolean) => void }
    }
  }
}

const NOTE_BODY = [
  '# Selection visibility check',
  '',
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.',
  '',
  'A second paragraph keeps the snapshot grounded with at least two text lines.',
].join('\n')

const TARGET_LINE = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.'

async function seedSettings(page: Page, themeId: string, overrides: Record<string, string>): Promise<void> {
  await page.addInitScript(
    ({ themeId, overrides }) => {
      try { window.localStorage.clear() } catch { /* ignore */ }
      try {
        for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
      } catch { /* ignore */ }
      try {
        window.localStorage.setItem(
          'noteser-settings',
          JSON.stringify({
            state: {
              onboardingShown: true,
              themeOverrides: overrides,
              notesOpenInPreviewMode: false,
            },
            version: 2,
          }),
        )
      } catch { /* ignore */ }
      // Strip animations and caret blink so the rendered frame is
      // deterministic across runs.
      const style = document.createElement('style')
      style.dataset.themeId = themeId
      style.textContent = `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
        .cm-cursor, .cm-dropCursor { visibility: hidden !important; }
      `
      const install = () => document.head.appendChild(style)
      if (document.head) install()
      else document.addEventListener('DOMContentLoaded', install, { once: true })
    },
    { themeId, overrides },
  )
}

async function seedAndOpenNote(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __noteser_test?: unknown }).__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )
  await page.evaluate((body) => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    const noteStore = hooks.stores.noteStore.getState()
    const note = noteStore.addNote({ folderId: null })
    noteStore.updateNote(note.id, { content: body })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
    hooks.stores.uiStore.getState().setPreviewMode(false)
  }, NOTE_BODY)
}

for (const preset of THEME_PRESETS) {
  test(`editor selection is visible in "${preset.id}" theme`, async ({ page }) => {
    await seedSettings(page, preset.id, preset.overrides)
    await page.goto('/')
    await expect(page.getByTestId('folder-tree')).toBeVisible()

    await seedAndOpenNote(page)

    const editor = page.locator('.cm-editor').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })

    // Wait for the target paragraph to render inside the editor before
    // selecting — content paint can lag a frame behind the .cm-editor
    // mount.
    const targetLine = editor.locator('.cm-line', { hasText: 'The quick brown fox' }).first()
    await expect(targetLine).toBeVisible({ timeout: 5_000 })

    await targetLine.click({ clickCount: 3 })

    // Confirm a non-empty selection rectangle painted before snapshotting.
    await expect(editor.locator('.cm-selectionBackground').first()).toBeVisible({ timeout: 5_000 })

    await expect(editor).toHaveScreenshot(`selection-${preset.id}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    })
  })
}
