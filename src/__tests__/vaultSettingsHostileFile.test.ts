/**
 * vaultSettingsHostileFile.test.ts
 *
 * `${settingsFolderPath}/settings.json` comes from the vault repo, so anyone
 * who can write that repo (a collaborator, a compromised token, a hostile
 * fork the user pulled) controls its contents. Two guards are under test:
 *
 *   1. parseVaultSettings type-checks every whitelisted key and drops the
 *      values that don't conform, instead of writing them into the store.
 *   2. applyRemoteVaultSettings never lets that file turn vault encryption
 *      OFF — the downgrade that would push note bodies in plaintext. Turning
 *      it ON is still allowed: that is how a fresh device learns the vault is
 *      encrypted.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { parseVaultSettings } from '../utils/vaultSettings'
import { useSettingsStore } from '../stores/settingsStore'

function fileWith(vault: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, updatedAt: 1_000, vault })
}

describe('parseVaultSettings — value validation', () => {
  test('drops wrong-typed values and keeps the conforming ones', () => {
    const parsed = parseVaultSettings(fileWith({
      // conforming
      attachmentsFolder: 'Files',
      folderSortMode: 'modified',
      showHiddenFolders: false,
      betaFlags: { plugins: true },
      dailyNoteTemplatePath: null,
      // hostile / corrupt
      taskListDensity: 'evil',                       // not in the enum
      trashMode: 'hardDeleteEverything',             // not in the enum
      confirmBulkDelete: 'no',                       // string, not boolean
      trashFolderName: { toString: 'gotcha' },       // object, not string
      themeOverrides: { accent: 42 },                // record of non-strings
      fontText: 'x'.repeat(513),                     // over the length cap
      vaultEncryptionSalt: 12345,                    // number, not string|null
    }))

    expect(parsed).not.toBeNull()
    expect(parsed!.vault).toEqual({
      attachmentsFolder: 'Files',
      folderSortMode: 'modified',
      showHiddenFolders: false,
      betaFlags: { plugins: true },
      dailyNoteTemplatePath: null,
    })
  })

  test('still ignores keys outside the vault-synced whitelist', () => {
    const parsed = parseVaultSettings(fileWith({ aiApiKey: 'sk-stolen', attachmentsFolder: 'Files' }))
    expect(parsed!.vault).toEqual({ attachmentsFolder: 'Files' })
  })
})

describe('applyRemoteVaultSettings — encryption downgrade', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      vaultEncryptionEnabled: false,
      vaultEncryptionSalt: null,
      vaultEncryptionCanary: null,
      vaultSettingsUpdatedAt: 0,
      vaultSettingsLastPushedHash: '',
    })
  })

  test('a hostile settings.json cannot flip encryption off', () => {
    useSettingsStore.setState({
      vaultEncryptionEnabled: true,
      vaultEncryptionSalt: 'real-salt',
      vaultEncryptionCanary: 'real-canary',
    })

    useSettingsStore.getState().applyRemoteVaultSettings(
      {
        vaultEncryptionEnabled: false,
        vaultEncryptionSalt: 'attacker-salt',
        vaultEncryptionCanary: 'attacker-canary',
        attachmentsFolder: 'Files',
      },
      2_000,
      'remote-hash',
    )

    const s = useSettingsStore.getState()
    expect(s.vaultEncryptionEnabled).toBe(true)
    expect(s.vaultEncryptionSalt).toBe('real-salt')
    expect(s.vaultEncryptionCanary).toBe('real-canary')
    // The rest of the file still applies — only the downgrade is refused.
    expect(s.attachmentsFolder).toBe('Files')
    expect(s.vaultSettingsUpdatedAt).toBe(2_000)
  })

  test('a fresh device still adopts encryption ON from the repo', () => {
    useSettingsStore.getState().applyRemoteVaultSettings(
      {
        vaultEncryptionEnabled: true,
        vaultEncryptionSalt: 'vault-salt',
        vaultEncryptionCanary: 'vault-canary',
      },
      3_000,
      'remote-hash',
    )

    const s = useSettingsStore.getState()
    expect(s.vaultEncryptionEnabled).toBe(true)
    expect(s.vaultEncryptionSalt).toBe('vault-salt')
    expect(s.vaultEncryptionCanary).toBe('vault-canary')
  })
})
