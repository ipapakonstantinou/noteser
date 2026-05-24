import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// QA gap coverage: export to markdown / json / html.
//
// The existing suite only checks the export module lazy-loads. Jon asked
// for export md/json/html to be exercised. This drives the real
// ExportModal end-to-end and asserts a download actually fires with a
// plausible filename for each format. "All notes" produces a .zip;
// "current note" produces a single file per format.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function seedAndOpenExport(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const a = ns.addNote({ title: 'First Note', content: '# First\n\nHello #alpha world.' })
    ns.addNote({ title: 'Second Note', content: '## Second\n\nMore text #beta.' })
    // Select the first note so "Current Note" export is enabled.
    window.__noteser_test!.stores.workspaceStore.getState().openNote(a.id, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'export' })
  })
  await expect(page.getByText('Export Notes')).toBeVisible()
}

test('export ALL notes as markdown downloads a zip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedAndOpenExport(page)

  // All Notes is the default exportType. Markdown is the default format.
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const name = download.suggestedFilename()
  console.log('MD_ALL_DOWNLOAD=' + name)
  expect(name).toMatch(/\.zip$/)
})

test('export CURRENT note as JSON downloads a .json file', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedAndOpenExport(page)

  await page.getByRole('button', { name: 'Current Note' }).click()
  await page.getByRole('button', { name: 'JSON', exact: true }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const name = download.suggestedFilename()
  console.log('JSON_CURRENT_DOWNLOAD=' + name)
  expect(name).toMatch(/\.json$/)
})

test('export CURRENT note as HTML downloads an .html file', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await seedAndOpenExport(page)

  await page.getByRole('button', { name: 'Current Note' }).click()
  await page.getByRole('button', { name: 'HTML', exact: true }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const name = download.suggestedFilename()
  console.log('HTML_CURRENT_DOWNLOAD=' + name)
  expect(name).toMatch(/\.html?$/)
})
