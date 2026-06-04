/**
 * settingsToggle.test.ts
 *
 * Covers the `confirmBeforeTrash` settings flag (added 2026-06-04 per
 * user feedback). Confirms the default + that the setter flips it. The
 * flag is device-only (not part of VAULT_SETTING_KEYS) so we don't
 * assert on vault-settings round-trip here.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useSettingsStore, VAULT_SETTING_KEYS } from '../stores/settingsStore'

describe('useSettingsStore — confirmBeforeTrash', () => {
  test('defaults to true (preserve existing safety net for new users)', () => {
    // Re-reading the default is enough; reset() restores DEFAULTS but
    // we don't want it to clobber unrelated stores in other tests.
    expect(useSettingsStore.getState().confirmBeforeTrash).toBe(true)
  })

  test('setConfirmBeforeTrash flips the field', () => {
    useSettingsStore.getState().setConfirmBeforeTrash(false)
    expect(useSettingsStore.getState().confirmBeforeTrash).toBe(false)
    useSettingsStore.getState().setConfirmBeforeTrash(true)
    expect(useSettingsStore.getState().confirmBeforeTrash).toBe(true)
  })

  test('flag is device-only (not in VAULT_SETTING_KEYS)', () => {
    // Including it in the vault slice would push the toggle across
    // every device a user owns — which defeats the "muscle memory is
    // per-device" rationale. Regression guard.
    expect((VAULT_SETTING_KEYS as readonly string[]).includes('confirmBeforeTrash'))
      .toBe(false)
  })
})
