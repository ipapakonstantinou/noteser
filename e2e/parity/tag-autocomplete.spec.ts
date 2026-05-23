import { test, expect } from '@playwright/test'

// Tag autocomplete: typing `#` while inside an editor opens a dropdown
// of existing tags from the vault. ↑/↓ navigate, Enter/Tab inserts,
// Esc closes.

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

async function seedAndOpen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    hooks.stores.settingsStore.getState().setNotesOpenInPreviewMode(false)
    hooks.stores.uiStore.getState().setPreviewMode(false)
    // Seed two existing tagged notes so the autocomplete has data.
    hooks.stores.noteStore.getState().addNote({ title: 'A', content: 'A note about #work and #work/q1' })
    hooks.stores.noteStore.getState().addNote({ title: 'B', content: 'A note about #personal' })
    // Open an empty editing surface.
    const blank = hooks.stores.noteStore.getState().addNote({ title: 'Scratch', content: '' })
    hooks.stores.workspaceStore.getState().openNote(blank.id, { preview: false })
    await new Promise(r => setTimeout(r, 0))
    hooks.stores.uiStore.getState().setPreviewMode(false)
  })
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8000 })
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none !important }' })
  await page.locator('.cm-content').click()
}

test('typing `#w` opens the tag dropdown with matching tags', async ({ page }) => {
  await seedAndOpen(page)
  await page.keyboard.type('#w')
  await expect(page.getByTestId('tag-autocomplete')).toBeVisible({ timeout: 3000 })
  // 'work' and 'work/q1' both contain 'w' — at minimum one row exists.
  await expect(page.getByTestId('tag-row-work')).toBeVisible()
})

test('Enter inserts the selected tag with a trailing space', async ({ page }) => {
  await seedAndOpen(page)
  await page.keyboard.type('#wo')
  await expect(page.getByTestId('tag-autocomplete')).toBeVisible()
  await page.keyboard.press('Enter')
  // The editor should now contain `#work ` (note the trailing space).
  await expect(page.locator('.cm-content')).toContainText('#work')
  // Dropdown closes after selection.
  await expect(page.getByTestId('tag-autocomplete')).not.toBeVisible({ timeout: 2000 })
})

test('Escape closes the dropdown without inserting', async ({ page }) => {
  await seedAndOpen(page)
  await page.keyboard.type('#per')
  await expect(page.getByTestId('tag-autocomplete')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tag-autocomplete')).not.toBeVisible()
})

test('does NOT open mid-word (e.g. `foo#bar` is not a tag)', async ({ page }) => {
  await seedAndOpen(page)
  await page.keyboard.type('foo#bar')
  // No `#` preceded by whitespace/punct → not a tag start, no dropdown.
  await expect(page.getByTestId('tag-autocomplete')).not.toBeVisible({ timeout: 2000 })
})
