import { test, expect, type Page } from '@playwright/test'

// Tab on a list line must nest it and keep focus in the editor, even after the
// keys that switch on CodeMirror's tab-focus mode (Esc then Tab, Ctrl+M).
// Before the fix Tab went to the next button instead. Real Chromium only:
// jsdom has no focus navigation.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try { for (const n of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(n) } catch { /* ignore */ }
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: {
          onboardingShown: true,
          sidebarGroups: [{ id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false }],
        },
        version: 3,
      }))
    } catch { /* ignore */ }
  })
})

async function content(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) =>
    window.__noteser_test!.stores.noteStore.getState().notes.find((n) => n.id === noteId)!.content, id)
}

test('Tab nests a list item after Esc and after Ctrl+M', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)

  const id = await page.evaluate(() =>
    window.__noteser_test!.stores.noteStore.getState()
      .addNote({ title: 'Tabs', content: '- one\n- two', folderId: null }).id)
  await page.evaluate((noteId) => {
    const el = document.querySelector(`[data-testid="note-row"][data-note-id="${noteId}"]`) as HTMLElement
    el.click(); el.click()
  }, id)

  const editor = page.locator('.cm-content')
  for (const before of ['Escape', 'Control+m']) {
    await page.locator('.cm-line').nth(1).click()
    await page.keyboard.press('End')
    await page.keyboard.press(before)
    await page.keyboard.press('Tab')
    await expect(editor).toBeFocused()
    await expect.poll(() => content(page, id)).toMatch(/^- one\n[ \t]+- two$/)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => content(page, id)).toBe('- one\n- two')
  }
})
