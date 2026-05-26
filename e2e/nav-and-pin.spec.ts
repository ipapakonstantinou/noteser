import { test, expect, type Page } from '@playwright/test'

// End-to-end coverage for the two note-navigation features:
//   1. Double-click a sidebar note → PINNED (non-italic) tab; single-click
//      → preview (italic) tab; right-click → Rename still works.
//   2. Back / Forward history (header arrows + Alt+←/→) walks A→B→C.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
  })
})

// Seed three root notes via the exposed test hook and return their ids.
async function seedNotes(page: Page): Promise<{ A: string; B: string; C: string }> {
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  return await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const A = ns.addNote({ title: 'Alpha', content: '# Alpha', folderId: null }).id
    const B = ns.addNote({ title: 'Beta', content: '# Beta', folderId: null }).id
    const C = ns.addNote({ title: 'Gamma', content: '# Gamma', folderId: null }).id
    return { A, B, C }
  })
}

const noteRow = (page: Page, id: string) => page.locator(`[data-testid="note-row"][data-note-id="${id}"]`)
const activeTabTitle = (page: Page) =>
  page.locator('.border-t-obsidianAccentPurple span.truncate').first()

test('single-click opens a preview (italic) tab; double-click pins it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  // Single click → preview tab (italic title in the tab strip).
  await noteRow(page, A).click()
  const title = activeTabTitle(page)
  await expect(title).toHaveText('Alpha')
  await expect(title).toHaveClass(/italic/)

  // Double click → promotes to pinned (non-italic), still a single tab.
  await noteRow(page, A).dblclick()
  await expect(title).toHaveText('Alpha')
  await expect(title).not.toHaveClass(/italic/)

  // Confirm in store: single note tab, not preview.
  const state = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const noteTabs = ws.panes.flatMap(p => p.tabs).filter(t => t.kind === 'note')
    return { count: noteTabs.length, preview: (noteTabs[0] as { isPreview?: boolean }).isPreview }
  })
  expect(state.count).toBe(1)
  expect(state.preview).toBe(false)
})

test('double-clicking a fresh note opens it pinned directly (no preview flash persists)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { B } = await seedNotes(page)

  await noteRow(page, B).dblclick()
  const title = activeTabTitle(page)
  await expect(title).toHaveText('Beta')
  await expect(title).not.toHaveClass(/italic/)
})

test('right-click → Rename still works after the double-click change', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A } = await seedNotes(page)

  await noteRow(page, A).click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  // Click the Rename item.
  await page.getByRole('button', { name: 'Rename' }).click()
  // An inline edit input should appear within the row; type a new name.
  const input = noteRow(page, A).locator('input')
  await expect(input).toBeVisible()
  await input.fill('Alpha Renamed')
  await input.press('Enter')

  const newTitle = await page.evaluate((id) => {
    return window.__noteser_test!.stores.noteStore.getState().notes.find(n => n.id === id)?.title
  }, A)
  expect(newTitle).toBe('Alpha Renamed')
})

test('Back / Forward header arrows walk A → B → C', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
  await expect(back).toBeEnabled()

  await back.click()
  await expect(title).toHaveText('Beta')
  await back.click()
  await expect(title).toHaveText('Alpha')
  await expect(back).toBeDisabled()

  await fwd.click()
  await expect(title).toHaveText('Beta')
  await fwd.click()
  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
})

test('Alt+Left / Alt+Right navigate history', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const title = activeTabTitle(page)
  await expect(title).toHaveText('Gamma')

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(title).toHaveText('Beta')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(title).toHaveText('Alpha')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(title).toHaveText('Beta')
})

test('navigating back then opening a new note truncates forward history', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { A, B, C } = await seedNotes(page)

  await noteRow(page, A).dblclick()
  await noteRow(page, B).dblclick()
  await noteRow(page, C).dblclick()

  const back = page.getByTestId('nav-back')
  const fwd = page.getByTestId('nav-forward')
  const title = activeTabTitle(page)

  await back.click() // B
  await back.click() // A
  await expect(title).toHaveText('Alpha')
  await expect(fwd).toBeEnabled()

  // Open C fresh — should truncate the B,C forward branch.
  await noteRow(page, C).dblclick()
  await expect(title).toHaveText('Gamma')
  await expect(fwd).toBeDisabled()
  await back.click()
  await expect(title).toHaveText('Alpha')
})
