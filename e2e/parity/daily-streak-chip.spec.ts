import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: daily-streak-chip
//
// Noteser behavior: EditorFooter shows a streak chip (data-testid=
// "status-bar-streak") when consecutive daily-notes exist for >= 2 days.
// The chip displays the streak count with a fire emoji.
//
// The streak is computed by computeStreakFromDateStrings() from note titles
// that match the user's dailyNoteDateFormat (default 'YYYY-MM-DD').

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

// Helper: format a date as YYYY-MM-DD for note titles.
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

test('streak chip appears when there are 2+ consecutive daily notes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Create daily notes for today + yesterday + day before.
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(today.getDate() - 2)

  await page.evaluate(({ t, y, a }) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n1 = store.addNote({ folderId: null })
    store.updateNote(n1.id, { title: t })
    const n2 = store.addNote({ folderId: null })
    store.updateNote(n2.id, { title: y })
    const n3 = store.addNote({ folderId: null })
    store.updateNote(n3.id, { title: a })
    // Open the most recent note so the editor footer mounts.
    window.__noteser_test!.stores.workspaceStore.getState().openNote(n1.id, { preview: false })
  }, {
    t: formatDate(today),
    y: formatDate(yesterday),
    a: formatDate(twoDaysAgo),
  })

  // Wait for the editor to mount (footer requires an open note).
  await expect(page.getByTestId('status-bar-footer')).toBeVisible({ timeout: 10_000 })

  // The streak chip should be visible.
  await expect(page.getByTestId('status-bar-streak')).toBeVisible()
  // Should show a number >= 3.
  const streakText = await page.getByTestId('status-bar-streak').textContent()
  expect(streakText).toMatch(/\d+/)
  const streakNum = parseInt(streakText!.replace(/\D/g, ''), 10)
  expect(streakNum).toBeGreaterThanOrEqual(3)
})

test('no streak chip when there is only one daily note', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const today = new Date()

  // Only one daily note — no consecutive streak.
  await page.evaluate(({ t }) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { title: t })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  }, { t: formatDate(today) })

  await expect(page.getByTestId('status-bar-footer')).toBeVisible({ timeout: 10_000 })

  // Streak chip should NOT appear with only a single daily note.
  await expect(page.getByTestId('status-bar-streak')).toHaveCount(0)
})

test('no streak chip when there is a gap in daily notes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const today = new Date()
  // Skip yesterday — gap breaks the streak.
  const threeDaysAgo = new Date(today)
  threeDaysAgo.setDate(today.getDate() - 3)

  await page.evaluate(({ t, a }) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const n1 = store.addNote({ folderId: null })
    store.updateNote(n1.id, { title: t })
    const n2 = store.addNote({ folderId: null })
    store.updateNote(n2.id, { title: a })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(n1.id, { preview: false })
  }, { t: formatDate(today), a: formatDate(threeDaysAgo) })

  await expect(page.getByTestId('status-bar-footer')).toBeVisible({ timeout: 10_000 })

  // With a gap, streak = 1 (today only) → chip should NOT appear.
  await expect(page.getByTestId('status-bar-streak')).toHaveCount(0)
})
