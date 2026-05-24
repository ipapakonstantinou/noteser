import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// QA gap coverage: daily notes via the calendar.
//
// The existing suite only checks the streak chip. Jon asked for
// daily-notes/calendar. The calendar lives under the 'calendar' sidebar
// tab. Clicking a day creates (or opens) a daily note titled with the
// configured date format and drops it in the daily-notes folder. The day
// cell then gets a "has note" dot.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('clicking today in the calendar creates and opens a daily note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Switch to the calendar sidebar tab.
  await page.getByTestId('sidebar-tab-calendar').click()

  // Today's cell is the accent-styled button. We compute today's day-of-month.
  const todayDom = await page.evaluate(() => new Date().getDate())

  // Click the day cell whose text is today's day-of-month. Multiple cells
  // could share digits across months but only the current month renders.
  const dayCell = page.getByRole('button', { name: String(todayDom), exact: true }).first()
  await dayCell.click()

  // A note opens — its title should be the formatted date (default YYYY-MM-DD).
  const expectedTitle = await page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })

  const titleInput = page.getByPlaceholder('Note title...').first()
  await expect(titleInput).toHaveValue(expectedTitle, { timeout: 10_000 })

  // The daily note was created in the store.
  const dailyExists = await page.evaluate((title) => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.some(n => !n.isDeleted && n.title === title)
  }, expectedTitle)
  expect(dailyExists).toBe(true)
})

test('clicking the same day twice reuses the existing daily note (no duplicate)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTestId('sidebar-tab-calendar').click()
  const todayDom = await page.evaluate(() => new Date().getDate())
  const dayCell = page.getByRole('button', { name: String(todayDom), exact: true }).first()

  await dayCell.click()
  await expect(page.getByPlaceholder('Note title...').first()).toBeVisible({ timeout: 10_000 })
  // Re-open the calendar tab (opening a note may switch the active panel).
  await page.getByTestId('sidebar-tab-calendar').click()
  await page.getByRole('button', { name: String(todayDom), exact: true }).first().click()

  const expectedTitle = await page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
  const count = await page.evaluate((title) => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    return notes.filter(n => !n.isDeleted && n.title === title).length
  }, expectedTitle)
  expect(count).toBe(1)
})
