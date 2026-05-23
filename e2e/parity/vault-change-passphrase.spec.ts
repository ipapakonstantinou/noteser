import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForTestHooks } from './_helpers'

// vault-change-passphrase
//
// Phase B follow-up: drives the full change-passphrase journey end to end:
//   enable (set passphrase)
//     -> lock
//     -> unlock (with the original passphrase)
//     -> change (old -> new, including the wrong-old rejection path)
//     -> lock
//     -> unlock with the NEW passphrase succeeds, the OLD passphrase fails.
//
// Scope: this flow is entirely client-side. No GitHub repo, no OAuth, and
// no Vercel secrets are needed. We seed a fake GitHub token only so the
// GitHub-sync settings panel (which hosts the encryption row) renders. The
// canary-verify-old-then-rotate logic lives in VaultEncryptionModal and
// vaultKey.ts and runs in the browser, so a local dev server is sufficient.
//
// Target: PLAYWRIGHT_BASE_URL env var. When run locally point it at your own
// dev server (e.g. http://localhost:3030); the default below matches the
// existing vault-encryption-ui spec's Vercel preview.
//
// Observed UX quirks reused from vault-encryption-ui.spec.ts:
//   - enable-submit, unlock-submit and change-submit all CLOSE the modal
//     (and the Settings modal) on success. We re-open Settings to inspect
//     the resulting status row.
//   - lock is instant and stays in place inside Settings.

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  'https://noteser-a8prgc4gj-ipapakonstantinous-projects.vercel.app'

const OLD_PASS = 'original-passphrase-001'
const NEW_PASS = 'rotated-passphrase-002'
const WRONG_OLD = 'definitely-not-the-old-001'

function seedFakeGitHubToken(page: Page) {
  return page.addInitScript(() => {
    try {
      window.localStorage.clear()
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    window.localStorage.setItem(
      'noteser-settings',
      JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
    )
    window.localStorage.setItem(
      'noteser-github',
      JSON.stringify({ state: { token: 'ghp_fake_for_ui_test' }, version: 0 }),
    )
  })
}

// Fill a passphrase field robustly. VaultEncryptionModal resets its fields
// in a useEffect when the modal opens or its mode changes; a fill issued
// before that effect runs can be wiped. Re-fill under toPass until the
// value sticks.
async function fillField(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId)
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 500 })
  }).toPass({ timeout: 5_000 })
}

async function openGitHubPanel(page: Page) {
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 15_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('settings-cat-github').click()
  await expect(page.getByTestId('settings-panel-github')).toBeVisible({ timeout: 5_000 })
}

// Enable encryption with OLD_PASS, then re-open Settings (enable-submit
// closes the Settings modal — the same observed behaviour the sibling spec
// documents).
async function enableWithOldPass(page: Page) {
  await openGitHubPanel(page)
  await page.getByTestId('settings-encryption-enable').click()
  const enableModal = page.getByRole('dialog').filter({ hasText: 'Enable vault encryption' })
  await expect(enableModal).toBeVisible({ timeout: 5_000 })
  await fillField(page, 'vault-encryption-passphrase', OLD_PASS)
  await fillField(page, 'vault-encryption-confirm', OLD_PASS)
  await page.getByTestId('vault-encryption-enable-submit').click()
  // On success the enable modal dismisses; with returnTo: 'settings' it
  // lands back in the Settings GitHub panel. Wait for the enable modal to
  // be gone, then ensure Settings is in front (re-open if it isn't).
  await expect(enableModal).not.toBeVisible({ timeout: 5_000 })
  if (!(await page.getByTestId('settings-panel-github').isVisible().catch(() => false))) {
    await openGitHubPanel(page)
  }
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i, { timeout: 5_000 })
}

// Lock from the Settings row (instant, in place) and confirm the status flips.
async function lockFromSettings(page: Page) {
  await page.getByTestId('settings-encryption-lock').click()
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/locked/i)
}

// Open the Unlock modal, type `pass`, submit. `expectSuccess` controls
// whether we wait for the modal to close (correct passphrase) or for the
// inline "Wrong passphrase" error (wrong passphrase).
async function unlockWith(page: Page, pass: string, expectSuccess: boolean) {
  await page.getByTestId('settings-encryption-unlock').click()
  const unlockModal = page.getByRole('dialog').filter({ hasText: 'Unlock vault' })
  await expect(unlockModal).toBeVisible({ timeout: 5_000 })
  await fillField(page, 'vault-encryption-unlock-passphrase', pass)
  await expect(page.getByTestId('vault-encryption-unlock-submit')).toBeEnabled({ timeout: 5_000 })
  await page.getByTestId('vault-encryption-unlock-submit').click()
  if (expectSuccess) {
    await expect(unlockModal).not.toBeVisible({ timeout: 5_000 })
    if (!(await page.getByTestId('settings-panel-github').isVisible().catch(() => false))) {
      await openGitHubPanel(page)
    }
    await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i, { timeout: 5_000 })
  } else {
    await expect(unlockModal.getByText(/wrong passphrase/i)).toBeVisible({ timeout: 5_000 })
    await expect(unlockModal).toBeVisible()
  }
}

// ── Test 1: change modal validation gates ────────────────────────────────────

test('1. change modal disables submit until current + valid new + matching confirm', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableWithOldPass(page)

  // The Change-passphrase button only renders while the vault is unlocked.
  await expect(page.getByTestId('settings-encryption-change')).toBeVisible()
  await page.getByTestId('settings-encryption-change').click()

  const changeModal = page.getByRole('dialog').filter({ hasText: 'Change vault passphrase' })
  await expect(changeModal).toBeVisible({ timeout: 5_000 })

  const submit = page.getByTestId('vault-encryption-change-submit')
  // Empty -> disabled.
  await expect(submit).toBeDisabled()

  // Current set, new too short -> still disabled, shows the length hint.
  await fillField(page, 'vault-encryption-change-current', OLD_PASS)
  await page.getByTestId('vault-encryption-change-new').fill('short')
  await expect(changeModal.getByText(/more.*character/i)).toBeVisible({ timeout: 3_000 })
  await expect(submit).toBeDisabled()

  // Valid new but mismatched confirm -> disabled, shows mismatch error.
  await page.getByTestId('vault-encryption-change-new').fill(NEW_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill('a-different-value-999')
  await expect(changeModal.getByText(/don.?t match/i)).toBeVisible({ timeout: 3_000 })
  await expect(submit).toBeDisabled()

  // New equal to current -> disabled, shows the must-differ error.
  await page.getByTestId('vault-encryption-change-new').fill(OLD_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill(OLD_PASS)
  await expect(changeModal.getByText(/must differ/i)).toBeVisible({ timeout: 3_000 })
  await expect(submit).toBeDisabled()

  // Fully valid -> enabled.
  await page.getByTestId('vault-encryption-change-new').fill(NEW_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill(NEW_PASS)
  await expect(submit).toBeEnabled({ timeout: 3_000 })

  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 2: wrong current passphrase is rejected inline ──────────────────────

test('2. change modal rejects a wrong current passphrase and keeps the OLD pass valid', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableWithOldPass(page)

  await page.getByTestId('settings-encryption-change').click()
  const changeModal = page.getByRole('dialog').filter({ hasText: 'Change vault passphrase' })
  await expect(changeModal).toBeVisible({ timeout: 5_000 })

  // Fill a WRONG current passphrase but otherwise-valid new + confirm.
  await fillField(page, 'vault-encryption-change-current', WRONG_OLD)
  await page.getByTestId('vault-encryption-change-new').fill(NEW_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill(NEW_PASS)

  const submit = page.getByTestId('vault-encryption-change-submit')
  await expect(submit).toBeEnabled({ timeout: 3_000 })
  await submit.click()

  // Inline "Current passphrase is wrong." error, modal stays open.
  await expect(changeModal.getByText(/current passphrase is wrong/i)).toBeVisible({ timeout: 5_000 })
  await expect(changeModal).toBeVisible()

  // The rotation must NOT have happened: cancel out, lock, and confirm the
  // ORIGINAL passphrase still unlocks (rotation would have invalidated it).
  await changeModal.getByRole('button', { name: /cancel/i }).click()
  // Cancel returns to Settings (returnTo: 'settings').
  await expect(page.getByTestId('settings-panel-github')).toBeVisible({ timeout: 5_000 })
  await lockFromSettings(page)
  await unlockWith(page, OLD_PASS, true)

  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 3: full journey, NEW unlocks and OLD fails after rotation ───────────

test('3. full journey: enable -> lock -> unlock -> change -> lock -> NEW unlocks, OLD fails', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)

  // enable (set passphrase) -> lock -> unlock with the ORIGINAL passphrase.
  await enableWithOldPass(page)
  await lockFromSettings(page)
  await unlockWith(page, OLD_PASS, true)

  // Capture the salt before rotation so we can assert it changed afterwards.
  const saltBefore = await page.evaluate(() => {
    const raw = window.localStorage.getItem('noteser-settings')
    const parsed = raw ? JSON.parse(raw) : null
    return (parsed?.state ?? parsed)?.vaultEncryptionSalt ?? null
  })
  expect(saltBefore).toBeTruthy()

  // change (old -> new). First a wrong-old attempt is rejected inline, then
  // the correct old rotates the passphrase.
  await page.getByTestId('settings-encryption-change').click()
  const changeModal = page.getByRole('dialog').filter({ hasText: 'Change vault passphrase' })
  await expect(changeModal).toBeVisible({ timeout: 5_000 })

  // Wrong-old rejection path.
  await fillField(page, 'vault-encryption-change-current', WRONG_OLD)
  await page.getByTestId('vault-encryption-change-new').fill(NEW_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill(NEW_PASS)
  await expect(page.getByTestId('vault-encryption-change-submit')).toBeEnabled({ timeout: 3_000 })
  await page.getByTestId('vault-encryption-change-submit').click()
  await expect(changeModal.getByText(/current passphrase is wrong/i)).toBeVisible({ timeout: 5_000 })
  await expect(changeModal).toBeVisible()

  // Correct old -> rotate succeeds, modal closes.
  await page.getByTestId('vault-encryption-change-current').fill(OLD_PASS)
  await page.getByTestId('vault-encryption-change-new').fill(NEW_PASS)
  await page.getByTestId('vault-encryption-change-confirm').fill(NEW_PASS)
  await expect(page.getByTestId('vault-encryption-change-submit')).toBeEnabled({ timeout: 3_000 })
  await page.getByTestId('vault-encryption-change-submit').click()
  // The change modal dismisses on success and (returnTo: 'settings') lands
  // back in Settings.
  await expect(changeModal).not.toBeVisible({ timeout: 5_000 })

  // Settings should be in front; vault stays unlocked across a rotate
  // (setVaultKey swaps the cached key without a lock transition).
  if (!(await page.getByTestId('settings-panel-github').isVisible().catch(() => false))) {
    await openGitHubPanel(page)
  }
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i, { timeout: 5_000 })

  // The salt + canary rotated (fresh salt generated on change).
  const after = await page.evaluate(() => {
    const raw = window.localStorage.getItem('noteser-settings')
    const parsed = raw ? JSON.parse(raw) : null
    const state = parsed?.state ?? parsed
    return { salt: state?.vaultEncryptionSalt ?? null, canary: state?.vaultEncryptionCanary ?? null }
  })
  expect(after.salt).toBeTruthy()
  expect(after.canary).toBeTruthy()
  expect(after.salt).not.toBe(saltBefore)

  // lock -> unlock: the NEW passphrase works.
  await lockFromSettings(page)
  await unlockWith(page, NEW_PASS, true)

  // lock again -> the OLD passphrase is now rejected (canary re-encrypted
  // under the new key).
  await lockFromSettings(page)
  await unlockWith(page, OLD_PASS, false)

  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})
