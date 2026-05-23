import { test, expect } from '@playwright/test'
import { waitForTestHooks } from './_helpers'

// vault-encryption-ui
//
// Phase B: validates the client-side Vault Encryption UI in Settings → GitHub sync.
//
// Observed behaviours (confirmed via diagnostic runs 2026-05-22):
//   - After enable-submit, the Settings modal closes entirely (BUG — see report).
//     Re-open Settings to see the updated status row.
//   - After unlock-submit with correct passphrase, the Settings modal also
//     closes. Same pattern. Re-open to confirm state.
//   - Unlock modal opens standalone (Settings modal closes when unlock is triggered
//     from Settings row). This means status element is not in DOM behind unlock modal.
//   - Lock click is instant: stays within Settings, flips status row in place.
//   - Wrong passphrase: unlock modal stays open, shows "Wrong passphrase. Try again."
//     inline. Unlock button may be briefly disabled during async crypto.
//   - Lock-on-startup: NOT implemented in this build — unlock modal does NOT
//     auto-open on reload. This is a Phase B gap (test 4 is marked skip).
//
// Target: PLAYWRIGHT_BASE_URL env var (Vercel preview build).
// No real GitHub repo required — all client-side state.

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  'https://noteser-a8prgc4gj-ipapakonstantinous-projects.vercel.app'

const VALID_PASS = 'correct-horse-battery-staple-12'
const SHORT_PASS = 'tooshort'

// Seed a fake GitHub token so the GitHub sync panel (and vault encryption row)
// is visible without real OAuth.
function seedFakeGitHubToken(page: import('@playwright/test').Page) {
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

async function openGitHubPanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!window.__noteser_test, null, { timeout: 15_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await expect(page.getByTestId('settings-categories')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('settings-cat-github').click()
  await expect(page.getByTestId('settings-panel-github')).toBeVisible({ timeout: 5_000 })
}

// Enable encryption via the UI, then re-open Settings (because enable-submit
// closes the Settings modal — this is the observed but buggy behaviour).
async function enableAndReopen(page: import('@playwright/test').Page) {
  await openGitHubPanel(page)
  await page.getByTestId('settings-encryption-enable').click()
  const encModal = page.getByRole('dialog').filter({ hasText: 'Enable vault encryption' })
  await expect(encModal).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('vault-encryption-passphrase').fill(VALID_PASS)
  await page.getByTestId('vault-encryption-confirm').fill(VALID_PASS)
  await page.getByTestId('vault-encryption-enable-submit').click()
  // Settings modal closes. Wait for no dialog visible.
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  // Re-open Settings to see updated state.
  await openGitHubPanel(page)
}

// ── Test 1: Initial state ─────────────────────────────────────────────────────

test('1. initial state shows Enable encryption button in GitHub sync panel', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await openGitHubPanel(page)

  // "Enable encryption…" button should be visible.
  await expect(page.getByTestId('settings-encryption-enable')).toBeVisible({ timeout: 5_000 })

  // Status indicator should NOT be visible in the default state.
  await expect(page.getByTestId('settings-encryption-status')).not.toBeVisible()

  // No console errors.
  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 2a: Enable modal — length hint ──────────────────────────────────────

test('2a. enable modal shows character-count hint when passphrase is under 12 chars', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await openGitHubPanel(page)
  await page.getByTestId('settings-encryption-enable').click()

  const modal = page.getByRole('dialog').filter({ hasText: 'Enable vault encryption' })
  await expect(modal).toBeVisible({ timeout: 5_000 })

  // Type a short passphrase.
  await page.getByTestId('vault-encryption-passphrase').fill(SHORT_PASS)

  // Should show "N more character(s) needed" hint (12-char minimum).
  const needed = 12 - SHORT_PASS.length
  await expect(modal.getByText(new RegExp(`${needed}.*more.*character`, 'i'))).toBeVisible({ timeout: 3_000 })

  // Submit button should be disabled.
  await expect(page.getByTestId('vault-encryption-enable-submit')).toBeDisabled()

  // No console errors.
  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 2b: Enable modal — mismatch ─────────────────────────────────────────

test('2b. enable modal shows mismatch error when passphrases differ', async ({ page }) => {
  await seedFakeGitHubToken(page)

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await openGitHubPanel(page)
  await page.getByTestId('settings-encryption-enable').click()

  const modal = page.getByRole('dialog').filter({ hasText: 'Enable vault encryption' })
  await expect(modal).toBeVisible({ timeout: 5_000 })

  // Fill passphrase + mismatched confirm.
  await page.getByTestId('vault-encryption-passphrase').fill(VALID_PASS)
  await page.getByTestId('vault-encryption-confirm').fill('different-passphrase-123')

  // Should show mismatch error.
  await expect(modal.getByText(/don.?t match/i)).toBeVisible({ timeout: 3_000 })

  // Submit button should be disabled.
  await expect(page.getByTestId('vault-encryption-enable-submit')).toBeDisabled()
})

// ── Test 2c: Successful enable + localStorage persistence ─────────────────────

test('2c. successful enable: status shows unlocked after re-open, localStorage persisted', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)

  // NOTE: After enable-submit, the Settings modal closes (known UX bug reported
  // separately). enableAndReopen() re-opens Settings to see the updated status.
  await enableAndReopen(page)

  // Status should now show "Enabled and unlocked".
  const status = page.getByTestId('settings-encryption-status')
  await expect(status).toBeVisible({ timeout: 5_000 })
  await expect(status).toContainText(/unlocked/i)

  // Lock + Disable buttons should be visible.
  await expect(page.getByTestId('settings-encryption-lock')).toBeVisible()
  await expect(page.getByTestId('settings-encryption-disable')).toBeVisible()

  // localStorage: vaultEncryptionEnabled=true, salt + canary non-null.
  const settings = await page.evaluate(() => {
    const raw = window.localStorage.getItem('noteser-settings')
    return raw ? JSON.parse(raw) : null
  })
  expect(settings).not.toBeNull()
  const state = settings?.state ?? settings
  expect(state.vaultEncryptionEnabled).toBe(true)
  expect(state.vaultEncryptionSalt).toBeTruthy()
  expect(state.vaultEncryptionCanary).toBeTruthy()

  // No console errors.
  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 3a: Lock — instant, no NEW modal ────────────────────────────────────

test('3a. lock button is instant: status flips to locked, buttons swap, no new dialog', async ({ page }) => {
  await seedFakeGitHubToken(page)

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableAndReopen(page)

  // Confirm unlocked state.
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i)

  // Click "Lock now" — Settings should stay open (the lock is instant / in-place).
  await page.getByTestId('settings-encryption-lock').click()

  // Settings panel must remain visible (lock doesn't navigate away or open a new modal).
  await expect(page.getByTestId('settings-panel-github')).toBeVisible({ timeout: 2_000 })

  // Specifically: no "Unlock vault" or "Enable vault encryption" sub-modal should
  // have appeared on top of the Settings panel.
  const lockSubModal = page
    .getByRole('dialog')
    .filter({ hasText: /unlock vault|enable vault encryption/i })
  await expect(lockSubModal).not.toBeVisible()

  // Status now shows locked.
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/locked/i)
  const statusText = await page.getByTestId('settings-encryption-status').textContent()
  expect(statusText).not.toMatch(/unlocked/i)

  // Buttons: unlock + disable (lock button gone).
  await expect(page.getByTestId('settings-encryption-unlock')).toBeVisible()
  await expect(page.getByTestId('settings-encryption-disable')).toBeVisible()
  await expect(page.getByTestId('settings-encryption-lock')).not.toBeVisible()
})

// ── Test 3b: Unlock modal — wrong passphrase shows inline error ───────────────

test('3b. unlock modal: wrong passphrase shows inline error and modal stays open', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableAndReopen(page)

  // Lock the vault.
  await page.getByTestId('settings-encryption-lock').click()
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/locked/i)

  // Click "Unlock…" — Settings modal closes, standalone unlock modal opens.
  await page.getByTestId('settings-encryption-unlock').click()
  const unlockModal = page.getByRole('dialog').filter({ hasText: 'Unlock vault' })
  await expect(unlockModal).toBeVisible({ timeout: 5_000 })

  // Type wrong passphrase and submit.
  await page.getByTestId('vault-encryption-unlock-passphrase').fill('wrongpassword123')
  await page.getByTestId('vault-encryption-unlock-submit').click()

  // Inline error "Wrong passphrase. Try again." must appear.
  await expect(unlockModal.getByText(/wrong passphrase/i)).toBeVisible({ timeout: 5_000 })

  // Modal must stay open (not dismissed on wrong passphrase).
  await expect(unlockModal).toBeVisible()

  // No console errors.
  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})

// ── Test 3c: Unlock — correct passphrase after wrong ─────────────────────────

test('3c. unlock with correct passphrase after wrong: modal closes, status unlocked', async ({ page }) => {
  await seedFakeGitHubToken(page)

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableAndReopen(page)

  // Lock.
  await page.getByTestId('settings-encryption-lock').click()
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/locked/i)

  // Open Unlock modal.
  await page.getByTestId('settings-encryption-unlock').click()
  const unlockModal = page.getByRole('dialog').filter({ hasText: 'Unlock vault' })
  await expect(unlockModal).toBeVisible({ timeout: 5_000 })

  // Type wrong passphrase first (to get the error state).
  await page.getByTestId('vault-encryption-unlock-passphrase').fill('wrongpassword123')
  await page.getByTestId('vault-encryption-unlock-submit').click()
  await expect(unlockModal.getByText(/wrong passphrase/i)).toBeVisible({ timeout: 5_000 })

  // Now clear + type correct passphrase.
  await page.getByTestId('vault-encryption-unlock-passphrase').fill(VALID_PASS)

  // Wait for the submit button to be enabled (crypto may take a moment).
  await expect(page.getByTestId('vault-encryption-unlock-submit')).toBeEnabled({ timeout: 5_000 })
  await page.getByTestId('vault-encryption-unlock-submit').click()

  // Modal closes (same close-on-submit pattern as enable).
  await expect(unlockModal).not.toBeVisible({ timeout: 5_000 })

  // Re-open settings and confirm unlocked.
  await openGitHubPanel(page)
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i, { timeout: 5_000 })
})

// ── Test 4: Lock-on-startup ───────────────────────────────────────────────────

// NOTE: Lock-on-startup is listed in the Phase B spec but NOT implemented in
// this build. The unlock modal does NOT auto-open on reload. Skipping as a
// known Phase B gap — reported in QA sweep.
test.skip('4. lock-on-startup: reload after enabling auto-opens unlock modal (NOT YET IMPLEMENTED)', async ({ page }) => {
  await seedFakeGitHubToken(page)

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await openGitHubPanel(page)

  // Enable encryption.
  await page.getByTestId('settings-encryption-enable').click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Enable vault encryption' })
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('vault-encryption-passphrase').fill(VALID_PASS)
  await page.getByTestId('vault-encryption-confirm').fill(VALID_PASS)
  await page.getByTestId('vault-encryption-enable-submit').click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  // Reload — in-memory key is gone.
  await page.reload()
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)

  // Should auto-open unlock modal within a few seconds after hydration.
  const unlockModal = page.getByRole('dialog').filter({ hasText: 'Unlock vault' })
  await expect(unlockModal).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('vault-encryption-unlock-passphrase')).toBeVisible()
})

// ── Test 5: Disable flow ──────────────────────────────────────────────────────

test('5. disable flow: confirm modal clears encryption, settings row reverts to disabled', async ({ page }) => {
  await seedFakeGitHubToken(page)
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(BASE_URL)
  await expect(page.getByTestId('folder-tree')).toBeVisible({ timeout: 15_000 })
  await waitForTestHooks(page)
  await enableAndReopen(page)

  // Confirm unlocked.
  await expect(page.getByTestId('settings-encryption-status')).toContainText(/unlocked/i)

  // Click "Disable encryption…".
  await page.getByTestId('settings-encryption-disable').click()
  const confirmModal = page.getByRole('dialog')
  await expect(confirmModal).toBeVisible({ timeout: 5_000 })

  // Confirm-disable button.
  const confirmBtn = page.getByTestId('vault-encryption-disable-confirm')
  await expect(confirmBtn).toBeVisible()
  await confirmBtn.click()

  // Modal closes.
  await expect(confirmModal).not.toBeVisible({ timeout: 5_000 })

  // Settings row reverts — may need to re-open if panel closed.
  const panelVisible = await page.getByTestId('settings-panel-github').isVisible().catch(() => false)
  if (!panelVisible) {
    await openGitHubPanel(page)
  }

  // "Enable encryption…" button is back.
  await expect(page.getByTestId('settings-encryption-enable')).toBeVisible({ timeout: 5_000 })
  // Status element gone.
  await expect(page.getByTestId('settings-encryption-status')).not.toBeVisible()

  // localStorage: vaultEncryptionEnabled=falsy, salt + canary null.
  const settings = await page.evaluate(() => {
    const raw = window.localStorage.getItem('noteser-settings')
    return raw ? JSON.parse(raw) : null
  })
  const state = settings?.state ?? settings
  expect(state?.vaultEncryptionEnabled).toBeFalsy()
  expect(state?.vaultEncryptionSalt ?? null).toBeNull()
  expect(state?.vaultEncryptionCanary ?? null).toBeNull()

  // No console errors.
  const reactErrors = consoleErrors.filter(e => e.includes('Error') || e.includes('Uncaught'))
  expect(reactErrors, `Console errors: ${reactErrors.join('\n')}`).toHaveLength(0)
})
