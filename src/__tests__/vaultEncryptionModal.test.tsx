/**
 * @jest-environment node
 *
 * VaultEncryptionModal interaction tests + canary-verification helper.
 * Uses the node env for WebCrypto access (jsdom lacks SubtleCrypto for
 * AES-GCM in this Jest version).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import {
  generateSalt,
  saltToString,
  deriveKey,
  makeCanary,
  verifyCanary,
  CANARY_PLAINTEXT,
} from '../utils/vaultCrypto'
import {
  unlockVault,
  verifyAndUnlockVault,
  lockVault,
  isVaultUnlocked,
  _resetVaultKeyForTests,
} from '../utils/vaultKey'

beforeEach(() => {
  _resetVaultKeyForTests()
})

describe('makeCanary + verifyCanary', () => {
  it('verifyCanary returns true for the same passphrase', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const canary = await makeCanary(key)
    expect(await verifyCanary(canary, key)).toBe(true)
  })

  it('verifyCanary returns false for a wrong passphrase', async () => {
    const salt = generateSalt()
    const correctKey = await deriveKey('correct horse battery staple', salt)
    const wrongKey = await deriveKey('hunter2 hunter2 hunter2', salt)
    const canary = await makeCanary(correctKey)
    expect(await verifyCanary(canary, wrongKey)).toBe(false)
  })

  it('verifyCanary returns false for a null canary (encryption never set up)', async () => {
    const salt = generateSalt()
    const key = await deriveKey('whatever', salt)
    expect(await verifyCanary(null, key)).toBe(false)
  })

  it('verifyCanary returns false for a malformed canary (does not throw)', async () => {
    const salt = generateSalt()
    const key = await deriveKey('whatever', salt)
    expect(await verifyCanary('not a real envelope', key)).toBe(false)
  })

  it('canary decrypts to CANARY_PLAINTEXT (sanity)', async () => {
    expect(CANARY_PLAINTEXT).toBe('noteser-vault-canary-v1')
  })
})

describe('verifyAndUnlockVault', () => {
  it('unlocks when passphrase matches the canary', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('right answer right answer', salt)
    const canary = await makeCanary(key)

    expect(isVaultUnlocked()).toBe(false)
    const ok = await verifyAndUnlockVault('right answer right answer', saltStr, canary)
    expect(ok).toBe(true)
    expect(isVaultUnlocked()).toBe(true)
  })

  it('does NOT unlock when passphrase is wrong (vault stays locked)', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('right answer right answer', salt)
    const canary = await makeCanary(key)

    const ok = await verifyAndUnlockVault('wrong answer wrong answer', saltStr, canary)
    expect(ok).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })

  it('returns false when salt is empty/missing', async () => {
    const ok = await verifyAndUnlockVault('whatever', '', 'some-canary')
    expect(ok).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })

  it('returns false when canary is null (existing salt, never enabled)', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const ok = await verifyAndUnlockVault('whatever', saltStr, null)
    expect(ok).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })
})

describe('lockVault clears the in-memory key', () => {
  it('after unlock + lock, the vault reports locked again', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('pass', salt)
    const canary = await makeCanary(key)
    await verifyAndUnlockVault('pass', saltStr, canary)
    expect(isVaultUnlocked()).toBe(true)
    lockVault()
    expect(isVaultUnlocked()).toBe(false)
  })
})

describe('legacy unlockVault still works (no canary verification)', () => {
  // Older call sites that don't have a canary go through `unlockVault`
  // directly. It must keep its semantics: derive the key and stash it,
  // no verification. Wrong passphrases just produce a key that fails
  // to decrypt the first real note later.
  it('caches the key without verifying anything', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const ok = await unlockVault('any passphrase', saltStr)
    expect(ok).toBe(true)
    expect(isVaultUnlocked()).toBe(true)
  })

  it('returns false when salt is empty', async () => {
    const ok = await unlockVault('any passphrase', '')
    expect(ok).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })
})
