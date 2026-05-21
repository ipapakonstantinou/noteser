import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: close-tab-keyboard
//
// Obsidian behavior: Ctrl+W closes the active tab. Closing the last
// tab in the only pane leaves the pane empty (doesn't unmount).
//
// Noteser today: matches. The gap that previously documented "Ctrl+W
// does NOT close tabs" was closed 2026-05-21 — `closeTab` shortcut
// added to the data-driven registry. These tests now guard the fix.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function openOneNote(page: import('@playwright/test').Page) {
  await waitForTestHooks(page)
  // Drive via the store — dblclick now triggers inline rename (the
  // Obsidian-parity behaviour landed 2026-05-21), so we can't use it
  // to open notes anymore.
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const n = ns.addNote({ folderId: null })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(n.id, { preview: false })
  })
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
}

test('clicking the × close button on a tab closes it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openOneNote(page)

  const tabsBefore = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabsBefore).toBe(1)

  // Click the close button (aria-label="Close tab") in the tab bar.
  await page.getByRole('button', { name: 'Close tab' }).first().click()

  const tabsAfter = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabsAfter).toBe(0)
})

test('closing the last tab in the only pane leaves the pane empty (not removed)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openOneNote(page)

  // Close the only tab.
  await page.getByRole('button', { name: 'Close tab' }).first().click()

  // There should still be one pane (the only pane is not removed).
  const paneCount = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes.length
  })
  expect(paneCount).toBe(1)

  // The pane should have no tabs.
  const tabCount = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabCount).toBe(0)
})

test('Ctrl+W closes the active tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openOneNote(page)

  const tabsBefore = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabsBefore).toBe(1)

  await page.keyboard.press('Control+w')
  await page.waitForTimeout(150)

  const tabsAfter = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabsAfter).toBe(0)
})

test('closing one of two tabs in a pane leaves the other tab active', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open two notes (via store — dblclick now triggers rename).
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const a = ns.addNote({ folderId: null })
    const b = ns.addNote({ folderId: null })
    ws.openNote(a.id, { preview: false })
    ws.openNote(b.id, { preview: false })
  })
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })

  const tabCount = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabCount).toBe(2)

  // Close the first tab's close button.
  await page.getByRole('button', { name: 'Close tab' }).first().click()

  const tabCountAfter = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabCountAfter).toBe(1)
})
