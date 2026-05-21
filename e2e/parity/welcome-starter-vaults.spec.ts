/**
 * welcome-starter-vaults
 *
 * Each of the 4 starter-vault cards seeds the correct vault shape:
 *   - Notes count > 0 in the store after seeding
 *   - At least one folder was created
 *   - Welcome tab closes after seeding
 *   - First note opens in the workspace
 *
 * Vault IDs under test: zettelkasten, daily-system, project-tracker, research
 *
 * Runs against the deployed app at https://noteser.thetechjon.com.
 */

import { test, expect } from '@playwright/test'

const DEPLOYED = 'https://noteser.thetechjon.com'

// Expected note counts per vault (based on starterVaults.ts definitions).
const VAULT_EXPECTATIONS = {
  zettelkasten: { minNotes: 5, minFolders: 4 },
  'daily-system': { minNotes: 3, minFolders: 4 },
  'project-tracker': { minNotes: 3, minFolders: 2 },
  research: { minNotes: 4, minFolders: 3 },
} as const

type VaultId = keyof typeof VAULT_EXPECTATIONS

function freshVault(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // onboardingShown = false so welcome tab auto-opens.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

for (const [vaultId, expectation] of Object.entries(VAULT_EXPECTATIONS) as [VaultId, { minNotes: number; minFolders: number }][]) {
  test(`${vaultId} starter vault seeds correctly`, async ({ page }) => {
    await freshVault(page)
    await page.goto(DEPLOYED)

    // Wait for welcome pane.
    await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

    // Click the vault card. Test id pattern: welcome-vault-<id>
    const vaultCard = page.getByTestId(`welcome-vault-${vaultId}`)
    await expect(vaultCard).toBeVisible()
    await vaultCard.click()

    // After click, welcome tab should close.
    await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 10_000 })

    // Wait for test hooks.
    await page.waitForFunction(
      () => typeof window.__noteser_test !== 'undefined',
      undefined,
      { timeout: 10_000 },
    )

    // Assert note count.
    const noteCount = await page.evaluate(() => {
      const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
      return notes.filter((n: { isDeleted: boolean }) => !n.isDeleted).length
    })
    expect(noteCount).toBeGreaterThanOrEqual(expectation.minNotes)

    // Assert folder count.
    const folderCount = await page.evaluate(() => {
      const folders = window.__noteser_test?.stores.folderStore.getState().folders ?? []
      return folders.length
    })
    expect(folderCount).toBeGreaterThanOrEqual(expectation.minFolders)

    // The editor area should now show a note (not an empty state).
    // Verify that at least some editor content is rendered.
    // The first note opened is the vault README, which should appear.
    await expect(page.locator('.cm-content, .prose').first()).toBeVisible({ timeout: 5_000 })
  })
}
