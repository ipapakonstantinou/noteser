import { test, expect } from '@playwright/test'

const PREVIEW = 'https://noteser.thetechjon.com'

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Skip welcome auto-open.
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
})

test('Fix 1: Ctrl+W closes the active tab', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)

  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const n = ns.addNote({ folderId: null })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(n.id, { preview: false })
  })
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.keyboard.press('Control+w')
  await page.waitForTimeout(200)
  const tabs = await page.evaluate(() =>
    window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.tabs.length ?? 0,
  )
  expect(tabs).toBe(0)
})

test('Fix 2: Ctrl+, opens Settings', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)

  await page.keyboard.press('Control+,')
  await page.waitForTimeout(200)
  const modalType = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().modal.type,
  )
  expect(modalType).toBe('settings')
})

test('Fix 3: Modal has role="dialog" + aria-modal', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
})

test('Fix 4: Restore option in right-click on a deleted note', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const a = ns.addNote({ folderId: null })
    ns.updateNote(a.id, { title: 'Trashed' })
    const b = ns.addNote({ folderId: null })
    ns.updateNote(b.id, { title: 'Active' })
    ns.deleteNotes([a.id])
  })
  await expect(page.getByTestId('trash-synthetic-folder')).toBeVisible()
  await page.getByTestId('trash-synthetic-folder').locator('button').first().click()
  const deletedRow = page.getByTestId('note-row').filter({ hasText: 'Trashed' })
  await deletedRow.click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible()
})

test('Fix 5: Double-click on note row triggers inline rename', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  await page.evaluate(() => {
    window.__noteser_test!.stores.noteStore.getState().addNote({ folderId: null })
  })
  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await page.getByTestId('note-row').first().dblclick()
  await page.waitForTimeout(150)
  const rename = await page.evaluate(() =>
    window.__noteser_test!.stores.uiStore.getState().renameRequest,
  )
  expect(rename?.type).toBe('note')
  await expect(page.getByTestId('note-row').first().locator('input')).toHaveCount(1)
})

test('Fix 6: splitTabRight keeps the empty left pane', async ({ page }) => {
  await page.goto(PREVIEW)
  await page.waitForFunction(() => !!window.__noteser_test)
  const tabId = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const n = ns.addNote({ folderId: null })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(n.id, { preview: false })
    // Re-read state — the openNote call mutated the store.
    return window.__noteser_test!.stores.workspaceStore.getState().panes[0]?.activeTabId
  })
  expect(tabId).toBeTruthy()
  await page.evaluate((tid) => {
    window.__noteser_test!.stores.workspaceStore.getState().splitTabRight(tid!)
  }, tabId)
  const panes = await page.evaluate(() =>
    window.__noteser_test!.stores.workspaceStore.getState().panes.map(p => p.tabs.length),
  )
  expect(panes).toEqual([0, 1])
})
