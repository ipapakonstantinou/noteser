import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: weekly-review-template
//
// Obsidian behavior: a "weekly review" template auto-includes the past
// week's notes (tasks, tags) when applied.
//
// Noteser today: Templates modal → "Weekly Review" calls buildWeeklyReview()
// which aggregates open tasks, done tasks, and top tags from the last 7 days.
// The resulting note is date-stamped. TemplatesModal is opened via
// openModal({ type: 'template' }).
//
// NOTE: the Modal component does NOT have role="dialog". Use the h2 heading
// "Create from Template" as the modal-visible indicator.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

// Locator for the Templates modal — identified by its header h2 text.
function templatesModal(page: import('@playwright/test').Page) {
  return page.locator('h2', { hasText: 'Create from Template' })
}

test('Templates modal opens and shows the Weekly Review template', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Open the templates modal via the store.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'template' })
  })

  // The modal header should be visible.
  await expect(templatesModal(page)).toBeVisible({ timeout: 5_000 })

  // The "Weekly Review" template option should be listed.
  const weeklyBtn = page.getByRole('button', { name: 'Weekly Review' })
  await expect(weeklyBtn).toBeVisible()
})

test('clicking Weekly Review creates a new date-stamped note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a few notes so the weekly review has something to aggregate.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note1 = store.addNote({ folderId: null })
    store.updateNote(note1.id, { content: '- [ ] Open task #project' })
    const note2 = store.addNote({ folderId: null })
    store.updateNote(note2.id, { content: '- [x] Done task #done' })
  })

  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'template' })
  })

  await expect(templatesModal(page)).toBeVisible({ timeout: 5_000 })

  // Click the "Weekly Review" template button.
  await page.getByRole('button', { name: 'Weekly Review' }).click()

  // Modal should close after selection.
  await expect(templatesModal(page)).toHaveCount(0)

  // A new note should have been created with a date-stamped title.
  const noteTitles = await page.evaluate(() => {
    return window.__noteser_test!.stores.noteStore.getState().notes
      .filter((n: { isDeleted: boolean }) => !n.isDeleted)
      .map((n: { title: string }) => n.title)
  })

  // Should contain a "Weekly Review YYYY-MM-DD" note.
  const weeklyReviewNote = noteTitles.find((t: string) => t.startsWith('Weekly Review'))
  expect(weeklyReviewNote).toBeTruthy()
  expect(weeklyReviewNote).toMatch(/^Weekly Review \d{4}-\d{2}-\d{2}$/)
})

test('Weekly Review note content contains # Weekly Review heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'template' })
  })

  await expect(templatesModal(page)).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Weekly Review' }).click()
  await expect(templatesModal(page)).toHaveCount(0)

  // Get the content of the newly created weekly review note.
  const weeklyContent = await page.evaluate(() => {
    const notes = window.__noteser_test!.stores.noteStore.getState().notes
    const wr = notes.find((n: { title: string; isDeleted: boolean }) =>
      !n.isDeleted && n.title.startsWith('Weekly Review')
    )
    return (wr as { content?: string })?.content ?? null
  })

  expect(weeklyContent).toBeTruthy()
  // buildWeeklyReview() starts with "# Weekly Review —"
  expect(weeklyContent).toMatch(/^# Weekly Review/)
})
