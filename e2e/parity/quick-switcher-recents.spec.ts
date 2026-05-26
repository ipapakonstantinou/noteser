import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: quick-switcher shows RECENT notes on empty query.
//
// Obsidian / VS Code Ctrl+P behavior: opening the quick switcher with an
// empty query lists the most-recently-opened files (most-recent-first).
// Typing replaces the recents with fuzzy results; clearing the query brings
// the recents back. Enter / arrow keys operate over the recents list too.
//
// Noteser: SearchModal renders `recents` from workspaceStore when the query
// box is empty. Recents rows reuse the same `[data-index]` row markup as
// search hits, fronted by a "Recent" header (data-testid="search-recent-header").

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function seedNotes(page: import('@playwright/test').Page, titles: string[]) {
  for (const title of titles) {
    await page.getByTestId('ribbon-item-new-note').click()
    const input = page.getByPlaceholder('Note title...').first()
    await input.fill(title)
    await page.keyboard.press('Tab')
  }
}

test('empty query shows recents most-recent-first; typing swaps to fuzzy; clearing restores', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Creating a note opens it, so opening order = recents order. After this,
  // recents (most-recent-first) is: Gamma, Beta, Alpha.
  await seedNotes(page, ['Alpha Note', 'Beta Project', 'Gamma Recipe'])

  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('search-input')).toBeVisible()

  // Empty query → the Recent header + the three recents appear.
  await expect(page.getByTestId('search-recent-header')).toBeVisible()
  const rows = page.locator('[data-index]')
  await expect(rows).toHaveCount(3)

  // Most-recent-first: the most recently opened note (Gamma) is row 0.
  await expect(rows.nth(0)).toContainText('Gamma Recipe')
  await expect(rows.nth(1)).toContainText('Beta Project')
  await expect(rows.nth(2)).toContainText('Alpha Note')

  // Typing → recents give way to fuzzy results (header gone), only Beta matches.
  await page.getByTestId('search-input').fill('Beta')
  await expect(page.getByTestId('search-recent-header')).toHaveCount(0)
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toContainText('Beta Project')

  // Clearing back to empty → recents return.
  await page.getByTestId('search-input').fill('')
  await expect(page.getByTestId('search-recent-header')).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Gamma Recipe')
})

test('Enter opens the top recent; arrow keys navigate the recents list', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await seedNotes(page, ['Alpha Note', 'Beta Project', 'Gamma Recipe'])

  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('search-input')).toBeVisible()
  await expect(page.locator('[data-index]')).toHaveCount(3)

  // Enter with no typing → opens the highlighted top recent (Gamma).
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('search-input')).toHaveCount(0)
  await expect(page.getByPlaceholder('Note title...').first()).toHaveValue('Gamma Recipe')

  // Re-open: Gamma was just opened so it is the freshest recent again.
  // ArrowDown twice moves selection to row 2 (Alpha), Enter opens it.
  await page.keyboard.press('Control+k')
  await expect(page.locator('[data-index]')).toHaveCount(3)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('search-input')).toHaveCount(0)
  await expect(page.getByPlaceholder('Note title...').first()).toHaveValue('Alpha Note')
})
