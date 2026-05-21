/**
 * vaultCrypto.test.ts
 *
 * Covers the passphrase-based encryption module that the upcoming "encrypted
 * backup" mode will sit on top of. The module is pure — no DOM, no store —
 * but it does need WebCrypto + TextEncoder/Decoder, neither of which jsdom
 * ships natively. We polyfill from Node before importing the module under
 * test, mirroring the pattern used in `attachments.test.ts`.
 */

// ── Web-API polyfills ───────────────────────────────────────────────────────
import { TextEncoder, TextDecoder } from 'util'
import { webcrypto } from 'crypto'

if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder
}
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true })
}

import {
  deriveKey,
  encryptNoteContent,
  decryptNoteContent,
  isEncryptedContent,
  generateSalt,
  saltToString,
  saltFromString,
} from '@/utils/vaultCrypto'

// PBKDF2 at 600k iterations is intentionally slow. A handful of derivations
// per test is fine; bumping the jest timeout keeps CI honest on slower boxes.
jest.setTimeout(30_000)

// ── helpers ─────────────────────────────────────────────────────────────────

// We can't directly compare two non-extractable CryptoKeys for equality, so
// instead we encrypt-with-A → decrypt-with-B. If the keys are functionally
// the same, the roundtrip succeeds; if not, AES-GCM throws an auth-tag
// `OperationError`.
async function keysAreEquivalent(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const probe = 'noteser-equivalence-probe'
  const encrypted = await encryptNoteContent(probe, a)
  try {
    const out = await decryptNoteContent(encrypted, b)
    return out === probe
  } catch {
    return false
  }
}

// Deterministic salt for the deriveKey tests so we aren't at the mercy of
// `crypto.getRandomValues` for assertions about determinism.
function fixedSalt(): Uint8Array {
  const salt = new Uint8Array(16)
  for (let i = 0; i < salt.length; i++) salt[i] = i + 1
  return salt
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('vaultCrypto.deriveKey', () => {
  it('is deterministic for the same passphrase + salt', async () => {
    const salt = fixedSalt()
    const k1 = await deriveKey('correct horse battery staple', salt)
    const k2 = await deriveKey('correct horse battery staple', salt)
    expect(await keysAreEquivalent(k1, k2)).toBe(true)
  })

  it('returns different keys for different salts', async () => {
    const passphrase = 'correct horse battery staple'
    const saltA = fixedSalt()
    const saltB = generateSalt() // statistically distinct from fixedSalt()
    const kA = await deriveKey(passphrase, saltA)
    const kB = await deriveKey(passphrase, saltB)
    expect(await keysAreEquivalent(kA, kB)).toBe(false)
  })

  it('returns different keys for different passphrases', async () => {
    const salt = fixedSalt()
    const kA = await deriveKey('alpha', salt)
    const kB = await deriveKey('beta', salt)
    expect(await keysAreEquivalent(kA, kB)).toBe(false)
  })
})

describe('vaultCrypto.encrypt / decrypt roundtrip', () => {
  it('roundtrips ASCII plaintext faithfully', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const plaintext = '# Hello\n\nThis is a normal markdown note.\n'
    const encrypted = await encryptNoteContent(plaintext, key)
    const decrypted = await decryptNoteContent(encrypted, key)
    expect(decrypted).toBe(plaintext)
  })

  it('roundtrips an empty string', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const encrypted = await encryptNoteContent('', key)
    const decrypted = await decryptNoteContent(encrypted, key)
    expect(decrypted).toBe('')
  })

  it('roundtrips Unicode (Greek, Chinese, emoji) faithfully', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const plaintext =
      'Καλημέρα κόσμε! 你好，世界！🦊🔐\n\nMixed: ABC δεφ 漢字 🎉'
    const encrypted = await encryptNoteContent(plaintext, key)
    const decrypted = await decryptNoteContent(encrypted, key)
    expect(decrypted).toBe(plaintext)
  })

  it('produces non-deterministic ciphertext for the same plaintext + key (IV varies)', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const plaintext = 'identical input every time'
    const c1 = await encryptNoteContent(plaintext, key)
    const c2 = await encryptNoteContent(plaintext, key)
    expect(c1).not.toBe(c2)
    // but both must decrypt to the same plaintext.
    expect(await decryptNoteContent(c1, key)).toBe(plaintext)
    expect(await decryptNoteContent(c2, key)).toBe(plaintext)
  })

  it('fails to decrypt with the wrong key', async () => {
    const salt = fixedSalt()
    const keyRight = await deriveKey('correct passphrase', salt)
    const keyWrong = await deriveKey('incorrect passphrase', salt)
    const encrypted = await encryptNoteContent('secret stuff', keyRight)
    await expect(decryptNoteContent(encrypted, keyWrong)).rejects.toThrow()
  })

  it('emits a banner that downstream consumers can detect', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const encrypted = await encryptNoteContent('payload', key)
    expect(encrypted.startsWith('---\nnoteser-encrypted: 1\n---\n')).toBe(true)
  })
})

describe('vaultCrypto.isEncryptedContent', () => {
  it('returns true for an encrypted envelope', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const encrypted = await encryptNoteContent('hi', key)
    expect(isEncryptedContent(encrypted)).toBe(true)
  })

  it('returns false for plain markdown', () => {
    expect(isEncryptedContent('# Just a heading\n\nWith body.\n')).toBe(false)
  })

  it('returns false for markdown with non-noteser frontmatter', () => {
    const plain = '---\ntitle: My Note\ntags: [a, b]\n---\n\nBody\n'
    expect(isEncryptedContent(plain)).toBe(false)
  })

  it('returns false for the empty string', () => {
    expect(isEncryptedContent('')).toBe(false)
  })
})

describe('vaultCrypto salt helpers', () => {
  it('generateSalt returns 16 random bytes', () => {
    const a = generateSalt()
    const b = generateSalt()
    expect(a.length).toBe(16)
    expect(b.length).toBe(16)
    // Astronomically unlikely to be equal — guards against an all-zero impl.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('saltToString / saltFromString are inverse', () => {
    const original = generateSalt()
    const encoded = saltToString(original)
    expect(typeof encoded).toBe('string')
    const decoded = saltFromString(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  it('saltFromString tolerates surrounding whitespace (file I/O leniency)', () => {
    const original = generateSalt()
    const encoded = saltToString(original)
    const decoded = saltFromString(`  ${encoded}\n`)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })
})

describe('vaultCrypto.decryptNoteContent — error paths', () => {
  it('throws when the input is not an encrypted envelope', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    await expect(decryptNoteContent('# plain markdown', key)).rejects.toThrow(
      /not a noteser-encrypted payload/
    )
  })

  it('throws when the envelope body is corrupted base64', async () => {
    const key = await deriveKey('passphrase', fixedSalt())
    const bogus = '---\nnoteser-encrypted: 1\n---\n!!!not-base64!!!\n'
    await expect(decryptNoteContent(bogus, key)).rejects.toThrow()
  })
})
