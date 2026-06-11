import { test, expect, type Page } from '@playwright/test'

// Regression coverage for Settings → General (#183):
//   1. Open on launch (startupNoteId)
//   2. Sort notes within folders (folderSortMode)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: {
          onboardingShown: true,
          sidebarGroups: [
            { id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false },
          ],
        },
        version: 3,
      }))
    } catch { /* ignore */ }
  })
})

async function seedNotes(page: Page) {
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  return await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const banana = ns.addNote({ title: 'Banana', content: '# Banana', folderId: null }).id
    const apple = ns.addNote({ title: 'Apple', content: '# Apple', folderId: null }).id
    const cherry = ns.addNote({ title: 'Cherry', content: '# Cherry', folderId: null }).id
    // Pad the vault so IDB rehydration is realistically slow — the
    // startup-note race only shows with a real-sized vault.
    const filler = '# Filler\n\n' + 'lorem ipsum dolor sit amet. '.repeat(400)
    for (let i = 0; i < 800; i++) {
      ns.addNote({ title: `Filler ${String(i).padStart(4, '0')}`, content: filler, folderId: null })
    }
    return { banana, apple, cherry }
  })
}

async function openSettingsGeneral(page: Page) {
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
}

const sidebarNoteTitles = (page: Page) =>
  page.locator('[data-testid="note-row"] span.truncate').allTextContents()

test('Open on launch: picked note opens as active tab after reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { apple } = await seedNotes(page)

  await openSettingsGeneral(page)
  const launchSelect = page.locator('select').first()
  const optionLabels = await launchSelect.locator('option').allTextContents()
  console.log('launch options:', JSON.stringify(optionLabels))
  await launchSelect.selectOption(apple)

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('noteser-settings') ?? '{}')?.state?.startupNoteId)
  console.log('persisted startupNoteId:', JSON.stringify(stored), 'expected:', apple)

  await page.getByTestId('settings-save-and-close').click()
  // Let the async IDB persist flush before navigating away.
  await page.waitForTimeout(800)

  // Fresh page WITHOUT the storage-wiping init script — `page.reload()`
  // would re-run addInitScript and clear the IDB-persisted notes.
  const page2 = await page.context().newPage()
  await page2.goto('/')
  await expect(page2.getByTestId('folder-tree')).toBeVisible()
  await page2.waitForTimeout(1500)
  const activeTab = page2.locator('.border-t-obsidianAccentPurple span.truncate').first()
  await expect(activeTab).toHaveText('Apple')
})

test('Sort notes within folders: switching mode reorders sidebar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  const { banana } = await seedNotes(page)

  console.log('initial order:', JSON.stringify(await sidebarNoteTitles(page)))

  // Touch Banana so "last modified" hoists it.
  await page.evaluate((id) => {
    window.__noteser_test!.stores.noteStore.getState().updateNote(id, { content: '# Banana touched' })
  }, banana)

  await openSettingsGeneral(page)
  const sortSelect = page.locator('select').nth(1)
  await sortSelect.selectOption('modified')
  await page.getByTestId('settings-save-and-close').click()
  await page.waitForTimeout(300)
  const afterModified = await sidebarNoteTitles(page)
  console.log('after modified:', JSON.stringify(afterModified))
  expect(afterModified[0]).toBe('Banana')

  await openSettingsGeneral(page)
  await page.locator('select').nth(1).selectOption('alphabetical')
  await page.getByTestId('settings-save-and-close').click()
  await page.waitForTimeout(300)
  const afterAlpha = await sidebarNoteTitles(page)
  console.log('after alphabetical (first 3):', JSON.stringify(afterAlpha.slice(0, 3)))
  expect(afterAlpha.slice(0, 3)).toEqual(['Apple', 'Banana', 'Cherry'])
})
