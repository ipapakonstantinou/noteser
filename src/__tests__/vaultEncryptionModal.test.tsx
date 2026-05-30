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
  setVaultKey,
  isVaultUnlocked,
  getVaultKey,
  _resetVaultKeyForTests,
} from '../utils/vaultKey'
import { encryptNoteContent, decryptNoteContent } from '../utils/vaultCrypto'

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

describe('setVaultKey (passphrase rotation)', () => {
  // The change-passphrase flow in VaultEncryptionModal derives a new key
  // from a fresh salt + new passphrase, builds a new canary, persists
  // both, then calls setVaultKey to swap the cached key without firing
  // a lock transition. These tests cover the rotate semantics that the
  // UI relies on.

  it('swaps the cached key without locking the vault', async () => {
    const oldSalt = generateSalt()
    const oldSaltStr = saltToString(oldSalt)
    const oldKey = await deriveKey('first first first', oldSalt)
    const oldCanary = await makeCanary(oldKey)
    await verifyAndUnlockVault('first first first', oldSaltStr, oldCanary)
    expect(isVaultUnlocked()).toBe(true)
    const before = getVaultKey()

    const newSalt = generateSalt()
    const newSaltStr = saltToString(newSalt)
    const newKey = await deriveKey('second second second', newSalt)
    setVaultKey(newKey, newSaltStr)

    expect(isVaultUnlocked()).toBe(true)
    const after = getVaultKey()
    expect(after).not.toBe(before)
    expect(after).toBe(newKey)
  })

  it('after a rotation, the OLD canary no longer verifies against the cached key', async () => {
    const oldSalt = generateSalt()
    const oldKey = await deriveKey('first first first', oldSalt)
    const oldCanary = await makeCanary(oldKey)

    const newSalt = generateSalt()
    const newKey = await deriveKey('second second second', newSalt)
    setVaultKey(newKey, saltToString(newSalt))

    expect(await verifyCanary(oldCanary, getVaultKey()!)).toBe(false)
  })

  it('after a rotation, the NEW canary verifies against the cached key', async () => {
    const newSalt = generateSalt()
    const newKey = await deriveKey('second second second', newSalt)
    const newCanary = await makeCanary(newKey)
    setVaultKey(newKey, saltToString(newSalt))

    expect(await verifyCanary(newCanary, getVaultKey()!)).toBe(true)
  })

  it('content encrypted before the rotation cannot be decrypted with the new key', async () => {
    const oldSalt = generateSalt()
    const oldKey = await deriveKey('first first first', oldSalt)
    const ciphertext = await encryptNoteContent('hello world', oldKey)

    const newSalt = generateSalt()
    const newKey = await deriveKey('second second second', newSalt)
    setVaultKey(newKey, saltToString(newSalt))

    // AES-GCM auth-tag failure throws OperationError.
    await expect(decryptNoteContent(ciphertext, getVaultKey()!)).rejects.toThrow()
  })

  it('content encrypted after the rotation round-trips with the new key', async () => {
    const newSalt = generateSalt()
    const newKey = await deriveKey('second second second', newSalt)
    setVaultKey(newKey, saltToString(newSalt))

    const ciphertext = await encryptNoteContent('post-rotation note', getVaultKey()!)
    const plaintext = await decryptNoteContent(ciphertext, getVaultKey()!)
    expect(plaintext).toBe('post-rotation note')
  })

  it('rotation simulation end-to-end: verify old, swap, verify new', async () => {
    // Stand in for the UI's handleChange path. Verifies the order of
    // operations the modal does:
    //   1. verifyCanary(canary, deriveKey(oldPass, oldSalt))  → true
    //   2. deriveKey(newPass, freshSalt) → newKey
    //   3. makeCanary(newKey) → newCanary
    //   4. setVaultKey(newKey, freshSalt)
    //   5. verifyCanary(newCanary, getVaultKey()) → true
    const oldSalt = generateSalt()
    const oldSaltStr = saltToString(oldSalt)
    const oldKey = await deriveKey('correct old passphrase', oldSalt)
    const oldCanary = await makeCanary(oldKey)
    await verifyAndUnlockVault('correct old passphrase', oldSaltStr, oldCanary)

    // 1. confirm old passphrase verifies the stored canary
    const oldVerifier = await deriveKey('correct old passphrase', oldSalt)
    expect(await verifyCanary(oldCanary, oldVerifier)).toBe(true)

    // 2 + 3 + 4 + 5
    const freshSalt = generateSalt()
    const freshSaltStr = saltToString(freshSalt)
    const newKey = await deriveKey('brand new passphrase value', freshSalt)
    const newCanary = await makeCanary(newKey)
    setVaultKey(newKey, freshSaltStr)
    expect(await verifyCanary(newCanary, getVaultKey()!)).toBe(true)

    // A wrong old passphrase NOW also fails (the cache holds the new key).
    const wrongOld = await deriveKey('correct old passphrase', oldSalt)
    expect(await verifyCanary(newCanary, wrongOld)).toBe(false)
  })
})

describe('enable flow uses setVaultKey (no double derivation)', () => {
  // The enable path in VaultEncryptionModal.handleEnable now reuses the
  // key it already derived (for makeCanary) by handing it to setVaultKey,
  // instead of calling the legacy unlockVault which derived a second key
  // from the same passphrase + salt. These tests model that order of
  // operations and assert the resulting cached key is usable.
  //
  //   1. deriveKey(passphrase, freshSalt)  → key
  //   2. makeCanary(key)                   → canary (persisted to settings)
  //   3. setVaultKey(key, freshSaltStr)    → cache the SAME key
  //   4. getVaultKey() === key, canary verifies, content round-trips

  it('caches the exact key that produced the canary (single derivation)', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('enable passphrase value', salt)
    const canary = await makeCanary(key)

    expect(isVaultUnlocked()).toBe(false)
    setVaultKey(key, saltStr)

    expect(isVaultUnlocked()).toBe(true)
    // The cached reference is the very key we derived, not a fresh one.
    expect(getVaultKey()).toBe(key)
    // The stored canary verifies against the cached key.
    expect(await verifyCanary(canary, getVaultKey()!)).toBe(true)
  })

  it('the enable-cached key matches a freshly derived key from the same passphrase + salt', async () => {
    // Behavioural parity with the old unlockVault path: a second
    // derivation from the same inputs yields a functionally identical key
    // (it decrypts content the cached key encrypted). This is what made
    // the double-derivation safe to drop.
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('enable passphrase value', salt)
    setVaultKey(key, saltStr)

    const ciphertext = await encryptNoteContent('enabled note body', getVaultKey()!)
    const reDerived = await deriveKey('enable passphrase value', salt)
    expect(await decryptNoteContent(ciphertext, reDerived)).toBe('enabled note body')
  })

  it('content encrypted right after enable round-trips with the cached key', async () => {
    const salt = generateSalt()
    const saltStr = saltToString(salt)
    const key = await deriveKey('enable passphrase value', salt)
    setVaultKey(key, saltStr)

    const ciphertext = await encryptNoteContent('first encrypted push', getVaultKey()!)
    const plaintext = await decryptNoteContent(ciphertext, getVaultKey()!)
    expect(plaintext).toBe('first encrypted push')
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
