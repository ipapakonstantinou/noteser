/**
 * vaultSettings.test.ts
 *
 * Tests the serialize / parse / hash helpers for vs8x (vault settings
 * sync). The whole point of these utilities is that round-tripping
 * stays canonical so the hash doesn't drift between identical states.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import {
  serializeVaultSettings,
  parseVaultSettings,
  vaultSettingsHash,
  vaultSettingsRepoPath,
  pickVaultSlice,
  VAULT_SETTINGS_FILE,
} from '../utils/vaultSettings'
import { VAULT_SETTING_KEYS, type SettingsState } from '../stores/settingsStore'

// Minimal SettingsState stub — only fields actually read by these
// helpers need to exist.
function fakeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    folderSortMode: 'alphabetical',
    taskListDensity: 'comfortable',
    showHiddenFolders: true,
    attachmentsFolder: 'Files',
    autoSyncOnStart: true,
    autoSyncIntervalMinutes: 0,
    dailyNotesFolder: 'Notes/Daily',
    dailyNoteDateFormat: 'YYYY-MM-DD',
    weeklyNotesFolder: 'Notes/Weekly',
    weeklyNoteDateFormat: 'YYYY-WW',
    monthlyNotesFolder: 'Notes/Monthly',
    monthlyNoteDateFormat: 'YYYY-MM',
    templatesFolder: 'Templates',
    dailyNoteTemplateId: null,
    aiProvider: 'off',
    aiApiKey: '',
    aiModel: '',
    shortcutOverrides: {},
    trashMode: 'trash',
    confirmBulkDelete: true,
    betaEnabled: false,
    betaFlags: {},
    ribbonOrder: [],
    sidebarTabOrder: [],
    pinnedPanels: ['calendar'],
    onboardingShown: false,
    settingsFolderPath: '.noteser',
    vaultSettingsUpdatedAt: 0,
    vaultSettingsLastPushedHash: '',
    ...overrides,
  } as SettingsState
}

test('pickVaultSlice returns only vault-tagged keys', () => {
  const s = fakeSettings({ aiApiKey: 'sk-secret', folderSortMode: 'modified' })
  const slice = pickVaultSlice(s)
  // Sanity: every vault key is present
  for (const k of VAULT_SETTING_KEYS) expect(k in slice).toBe(true)
  // Sensitive / device-only keys are NOT present
  expect('aiApiKey' in slice).toBe(false)
  expect('aiProvider' in slice).toBe(false)
  expect('settingsFolderPath' in slice).toBe(false)
  expect('pinnedPanels' in slice).toBe(false)
})

test('serialize → parse round-trips a vault slice cleanly', () => {
  const s = fakeSettings({
    folderSortMode: 'modified',
    taskListDensity: 'compact',
    trashMode: 'hardDelete',
    confirmBulkDelete: false,
  })
  const ts = 1716200000000
  const raw = serializeVaultSettings(pickVaultSlice(s), ts)
  const parsed = parseVaultSettings(raw)
  expect(parsed).not.toBeNull()
  expect(parsed!.version).toBe(1)
  expect(parsed!.updatedAt).toBe(ts)
  expect(parsed!.vault.folderSortMode).toBe('modified')
  expect(parsed!.vault.taskListDensity).toBe('compact')
  expect(parsed!.vault.trashMode).toBe('hardDelete')
  expect(parsed!.vault.confirmBulkDelete).toBe(false)
})

test('serialize is canonical — same logical content = same hash', () => {
  const s1 = fakeSettings({ folderSortMode: 'manual', dailyNotesFolder: 'X/Y' })
  const s2 = fakeSettings({ dailyNotesFolder: 'X/Y', folderSortMode: 'manual' })
  const a = serializeVaultSettings(pickVaultSlice(s1), 42)
  const b = serializeVaultSettings(pickVaultSlice(s2), 42)
  expect(a).toBe(b)
  expect(vaultSettingsHash(a)).toBe(vaultSettingsHash(b))
})

test('serialize differs when a vault field changes', () => {
  const s1 = fakeSettings({ folderSortMode: 'alphabetical' })
  const s2 = fakeSettings({ folderSortMode: 'modified' })
  const a = serializeVaultSettings(pickVaultSlice(s1), 42)
  const b = serializeVaultSettings(pickVaultSlice(s2), 42)
  expect(a).not.toBe(b)
  expect(vaultSettingsHash(a)).not.toBe(vaultSettingsHash(b))
})

test('parseVaultSettings rejects malformed payloads', () => {
  expect(parseVaultSettings('')).toBeNull()
  expect(parseVaultSettings('not json')).toBeNull()
  expect(parseVaultSettings('[]')).toBeNull()
  expect(parseVaultSettings('{"version":99}')).toBeNull()
  expect(parseVaultSettings('{"version":1}')).toBeNull() // missing updatedAt
  expect(parseVaultSettings('{"version":1,"updatedAt":1}')).toBeNull() // missing vault
})

test('parseVaultSettings whitelists unknown vault keys', () => {
  // A future / malicious writer dropping an unexpected key (e.g.
  // attempting to inject an API key) should be ignored.
  const raw = JSON.stringify({
    version: 1,
    updatedAt: 1,
    vault: { folderSortMode: 'modified', aiApiKey: 'sk-evil', unrelated: 42 },
  })
  const parsed = parseVaultSettings(raw)
  expect(parsed).not.toBeNull()
  expect(parsed!.vault.folderSortMode).toBe('modified')
  expect('aiApiKey' in parsed!.vault).toBe(false)
  expect('unrelated' in parsed!.vault).toBe(false)
})

test('vaultSettingsRepoPath strips slashes + builds full path', () => {
  expect(vaultSettingsRepoPath('.noteser')).toBe(`.noteser/${VAULT_SETTINGS_FILE}`)
  expect(vaultSettingsRepoPath('/.noteser/')).toBe(`.noteser/${VAULT_SETTINGS_FILE}`)
  expect(vaultSettingsRepoPath('  config/noteser  ')).toBe(`config/noteser/${VAULT_SETTINGS_FILE}`)
})

test('vaultSettingsRepoPath returns null for empty / whitespace-only', () => {
  expect(vaultSettingsRepoPath('')).toBeNull()
  expect(vaultSettingsRepoPath('   ')).toBeNull()
  expect(vaultSettingsRepoPath('///')).toBeNull()
})

test('hash is stable across runs (deterministic)', () => {
  const raw = '{"hello":"world"}'
  expect(vaultSettingsHash(raw)).toBe(vaultSettingsHash(raw))
})
