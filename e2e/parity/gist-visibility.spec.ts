/**
 * Validates the "Publish as gist" context-menu visibility logic.
 *
 * Feature: feat/gist-publish
 *
 * Rule: The menu item should only appear when a GitHub token is present
 * in the store. We test the absence-without-token case (the safe,
 * non-OAuth-dependent path) and the presence-with-token case (injected
 * via localStorage before hydration).
 */

import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001'

test.describe('Publish as gist — context menu visibility', () => {
  test('without GitHub token: "Publish as gist" does NOT appear in note context menu', async ({ page }) => {
    await setupCleanVault(page)
    await page.goto(BASE)
    await expect(page.getByTestId('folder-tree')).toBeVisible()

    // Create a note so we have something to right-click.
    await page.getByTitle('New note (Alt+N)').click()
    await page.waitForTimeout(500)

    // Right-click the first note row in the sidebar.
    const noteRow = page.getByTestId('note-row').first()
    await expect(noteRow).toBeVisible({ timeout: 5000 })
    await noteRow.click({ button: 'right' })

    // Context menu should appear (it's a plain div, not role="menu").
    // Wait for a known menu item to confirm the menu opened.
    await expect(page.getByText('Rename')).toBeVisible({ timeout: 3000 })

    // "Publish as gist" must NOT appear without a token.
    await expect(page.getByText('Publish as gist')).toHaveCount(0)

    await page.screenshot({ path: 'playwright-report/notes/gist-no-token.png' })
  })

  test('with GitHub token in localStorage: "Publish as gist" DOES appear', async ({ page }) => {
    // Inject a fake GitHub token before hydration.
    await page.addInitScript(() => {
      try { window.localStorage.clear() } catch { /* ignore */ }
      try {
        const dbs = ['noteser', 'keyval-store']
        for (const name of dbs) (window as unknown as { indexedDB: IDBFactory }).indexedDB.deleteDatabase(name)
      } catch { /* ignore */ }
      try {
        window.localStorage.setItem(
          'noteser-settings',
          JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
        )
        // Inject a fake token so hasGithubToken === true.
        // No version field — githubStore has no version config.
        window.localStorage.setItem(
          'noteser-github',
          JSON.stringify({
            state: {
              token: 'fake-token-for-ui-test',
              user: null,
              connectedAt: null,
              syncRepo: null,
              lastSyncedAt: null,
              lastCommitSha: null,
              repoSyncStates: {},
            },
          }),
        )
      } catch { /* ignore */ }
    })

    await page.goto(BASE)
    await expect(page.getByTestId('folder-tree')).toBeVisible()

    // Create a note so we have something to right-click.
    await page.getByTitle('New note (Alt+N)').click()
    await page.waitForTimeout(500)

    const noteRow = page.getByTestId('note-row').first()
    await expect(noteRow).toBeVisible({ timeout: 5000 })
    await noteRow.click({ button: 'right' })

    // Context menu appears (plain div, not role="menu").
    await expect(page.getByText('Rename')).toBeVisible({ timeout: 3000 })

    // "Publish as gist" MUST appear when a token is present.
    await expect(page.getByText('Publish as gist')).toBeVisible({ timeout: 2000 })

    await page.screenshot({ path: 'playwright-report/notes/gist-with-token.png' })
  })
})
