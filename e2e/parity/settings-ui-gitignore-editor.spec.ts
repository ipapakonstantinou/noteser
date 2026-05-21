import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// settings-ui-gitignore-editor
//
// Covers two scenarios:
//   1. settings-gitignore-editor-empty
//      When no GitHub token + no syncRepo are configured, the vault gitignore
//      field should render a disabled textarea and a disabled fetch button with
//      the "Connect a sync repo to enable." hint text.
//
//   2. settings-gitignore-dirty-marker
//      Manipulate settingsStore directly to set snapshot + draft and verify
//      the "Will push on next sync" badge appears / disappears as expected.
//      (No real GitHub creds required.)
//
// Target: https://noteser.thetechjon.com (deployed build).

const BASE_URL = 'https://noteser.thetechjon.com'

async function openGitHubPanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 10_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible()
  await page.getByTestId('settings-cat-github').click()
  // Wait for the GitHub sync panel outer container.
  await expect(page.getByTestId('settings-panel-github')).toBeVisible({ timeout: 3_000 })
}

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

// ── Test 1: not-connected state ──────────────────────────────────────────────

test('gitignore textarea and fetch button are disabled when no sync repo is connected', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await openGitHubPanel(page)

  // The textarea is always rendered (not conditional on connection).
  const textarea = page.getByTestId('vault-gitignore-textarea')
  await expect(textarea).toBeVisible()
  await expect(textarea).toBeDisabled()

  // The fetch button is always rendered, but disabled when not connected.
  const fetchBtn = page.getByTestId('vault-gitignore-fetch')
  await expect(fetchBtn).toBeVisible()
  await expect(fetchBtn).toBeDisabled()

  // The helper text "Connect a sync repo to enable." should be visible.
  await expect(
    page.getByTestId('settings-panel-github').getByText('Connect a sync repo to enable.')
  ).toBeVisible()
})

// ── Test 2: dirty-marker logic via store manipulation ────────────────────────

test('vault-gitignore-dirty badge appears when draft differs from snapshot, disappears when equal', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await openGitHubPanel(page)

  // Seed the settingsStore directly so we don't need a real GitHub token.
  // Set snapshot = "*.log" and draft = "*.log\nbuild/" → dirty.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.settingsStore.getState()
    store.setVaultGitignoreRemoteSnapshot('*.log')
    store.setVaultGitignoreDraft('*.log\nbuild/')
  })

  // The "Will push on next sync" badge should now be visible.
  await expect(page.getByTestId('vault-gitignore-dirty')).toBeVisible({ timeout: 3_000 })

  // Now snap draft back to match snapshot → badge should disappear.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.settingsStore.getState()
    store.setVaultGitignoreDraft('*.log')
  })

  await expect(page.getByTestId('vault-gitignore-dirty')).not.toBeVisible({ timeout: 3_000 })
})

test('vault-gitignore discard button snaps draft back to snapshot and clears dirty marker', async ({ page }) => {
  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await openGitHubPanel(page)

  // Make it dirty.
  await page.evaluate(() => {
    const store = window.__noteser_test!.stores.settingsStore.getState()
    store.setVaultGitignoreRemoteSnapshot('*.log')
    store.setVaultGitignoreDraft('*.log\nextra-line')
  })

  await expect(page.getByTestId('vault-gitignore-dirty')).toBeVisible()

  // Click Discard.
  await page.getByTestId('vault-gitignore-discard').click()

  // Dirty marker should disappear.
  await expect(page.getByTestId('vault-gitignore-dirty')).not.toBeVisible({ timeout: 3_000 })

  // The textarea value should revert to snapshot content.
  const textareaValue = await page.getByTestId('vault-gitignore-textarea').inputValue()
  expect(textareaValue).toBe('*.log')
})
