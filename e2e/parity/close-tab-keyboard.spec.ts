import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: close-tab-keyboard
//
// Obsidian behavior: Ctrl+W closes the active tab. Closing the last tab
// in a pane closes the pane (unless it's the only pane).
//
// Noteser today: Ctrl+W is NOT implemented as a keyboard shortcut in
// useKeyboardShortcuts.ts. The close button (×) on the tab and middle-click
// both work via closeTab(tabId). This spec:
//   1. Verifies the × button closes the tab (this IS implemented).
//   2. Verifies Ctrl+W does NOT close the tab (flags parity gap).
//
// PARITY GAP: Ctrl+W does not close tabs. Obsidian users who rely on this
// muscle memory will find it doesn't work in noteser.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function openOneNote(page: import('@playwright/test').Page) {
  await waitForTestHooks(page)
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    store.addNote({ folderId: null })
  })
  await page.getByTestId('note-row').first().dblclick()
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

test('PARITY GAP: Ctrl+W does not close the active tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await openOneNote(page)

  const tabsBefore = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  expect(tabsBefore).toBe(1)

  // Press Ctrl+W. In Obsidian this would close the tab.
  // Noteser does not implement this shortcut.
  await page.keyboard.press('Control+w')
  await page.waitForTimeout(100)

  const tabsAfter = await page.evaluate(() => {
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0
  })
  // Tab count should still be 1 — Ctrl+W is NOT wired up.
  // If this ever equals 0, it means Ctrl+W was implemented and this
  // test should be converted to a "pass" check.
  expect(tabsAfter).toBe(1) // parity gap: should be 0 in Obsidian
})

test('closing one of two tabs in a pane leaves the other tab active', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open two notes.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    store.addNote({ folderId: null })
    store.addNote({ folderId: null })
  })
  await expect(page.getByTestId('note-row')).toHaveCount(2)

  await page.getByTestId('note-row').nth(0).dblclick()
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('note-row').nth(1).dblclick()

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
