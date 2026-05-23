import { test, expect } from '@playwright/test'

// Empty-state pane CTAs: when the workspace has no active tab, the
// editor surface shows "Open today's daily note" + "New note"
// buttons next to the existing copy.

type TestHooks = {
  stores: {
    noteStore: { getState(): { addNote: (i: Partial<{ title: string }>) => { id: string } } }
    workspaceStore: { getState(): { closeAllTabs?: () => void; panes: { id: string; tabs: { id: string }[] }[] } }
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

// Land on the empty state by clearing the workspace's tabs after hydration.
async function loadEmptyPane(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __noteser_test?: unknown }).__noteser_test),
  )
  // Close any auto-opened tab (e.g. welcome or restored selection) so
  // we exercise the empty-state branch.
  await page.evaluate(() => {
    const hooks = (window as unknown as { __noteser_test: TestHooks }).__noteser_test
    const panes = hooks.stores.workspaceStore.getState().panes
    const store = hooks.stores.workspaceStore as unknown as {
      getState(): { closeTab?: (id: string) => void }
    }
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        store.getState().closeTab?.(tab.id)
      }
    }
  })
}

test('renders the empty-state CTAs', async ({ page }) => {
  await loadEmptyPane(page)
  await expect(page.getByTestId('empty-state-daily-note')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('empty-state-new-note')).toBeVisible()
})

test('"New note" creates a note and opens it', async ({ page }) => {
  await loadEmptyPane(page)
  await page.getByTestId('empty-state-new-note').click()
  // After clicking, a note tab should appear in the tab bar.
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5000 })
})

test('"Open today\'s daily note" creates today\'s note and opens it', async ({ page }) => {
  await loadEmptyPane(page)
  await page.getByTestId('empty-state-daily-note').click()
  // Today's note opens in the editor.
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5000 })
  // The title should match today's date in the configured format
  // (default YYYY-MM-DD). Just assert that an .md-style date title is
  // present in some tab.
  const today = new Date().toISOString().slice(0, 10)
  await expect(page.locator(`text=${today}`).first()).toBeVisible({ timeout: 5000 })
})
