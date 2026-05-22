// Passphrase-based encryption building blocks for the optional "encrypted
// backup" mode. None of this is wired into the sync pipeline yet — that is a
// follow-up branch. This module exposes pure functions that a future
// integration can call between "serialise note to markdown" and
// `createBlob(content)` in `githubSync.ts`.
//
// Design:
//   * Key derivation:  PBKDF2-SHA256, 600 000 iterations (current OWASP
//                      recommendation for PBKDF2-SHA256, 2023+), 256-bit
//                      AES-GCM key, per-vault 16-byte salt.
//   * Symmetric cipher: AES-GCM with a fresh 12-byte IV per encryption.
//   * Envelope on disk: a JSON object `{ v, iv, ct }` base64-encoded inside a
//                      tiny YAML banner so the file still parses as markdown
//                      with frontmatter — keeping the GitHub repo "looks like
//                      noteser" rather than "looks like opaque binary".
//
// We deliberately avoid any third-party crypto: WebCrypto is part of the
// browser + Node 22 standard libraries.

const PBKDF2_ITERATIONS = 600_000
const PBKDF2_HASH = 'SHA-256'
const AES_KEY_LENGTH_BITS = 256
const AES_IV_LENGTH_BYTES = 12
const SALT_LENGTH_BYTES = 16
const ENVELOPE_VERSION = 1

const ENCRYPTED_BANNER_OPEN = '---\nnoteser-encrypted: 1\n---\n'

// ── base64 helpers ───────────────────────────────────────────────────────────
// We use `btoa`/`atob` since both browsers and Node 22 expose them globally.
// They operate on binary strings, so we marshal `Uint8Array` through
// `String.fromCharCode` (chunked to avoid blowing the argument limit on large
// payloads).

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ── salt helpers ─────────────────────────────────────────────────────────────

// Generate a fresh 16-byte salt. Called once when the user first enables
// encryption for a vault; persisted alongside the encrypted blobs in
// `.noteser/vault-salt`.
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH_BYTES)
  crypto.getRandomValues(salt)
  return salt
}

export function saltToString(salt: Uint8Array): string {
  return bytesToBase64(salt)
}

export function saltFromString(s: string): Uint8Array {
  return base64ToBytes(s.trim())
}

// ── key derivation ───────────────────────────────────────────────────────────

// Derive a 256-bit AES-GCM key from `passphrase` + `salt` via PBKDF2-SHA256.
// Deterministic: same inputs → same key (verified by tests). The returned
// `CryptoKey` is non-extractable and usable for encrypt+decrypt.
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passphraseBytes = encoder.encode(passphrase)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passphraseBytes as unknown as ArrayBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

// ── envelope ─────────────────────────────────────────────────────────────────

interface EncryptedEnvelope {
  v: number
  iv: string // base64
  ct: string // base64
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.v === 'number' &&
    typeof obj.iv === 'string' &&
    typeof obj.ct === 'string'
  )
}

// Cheap synchronous check used by the pull path. Matches the banner only —
// validating the inner envelope (and decrypting) is the caller's job.
export function isEncryptedContent(content: string): boolean {
  if (typeof content !== 'string') return false
  return content.startsWith(ENCRYPTED_BANNER_OPEN)
}

function extractEnvelopeBody(content: string): string {
  // Strip the banner; everything after it is the base64-encoded envelope.
  // Trim trailing whitespace/newlines that an editor might have introduced.
  return content.slice(ENCRYPTED_BANNER_OPEN.length).trim()
}

// ── encrypt / decrypt ────────────────────────────────────────────────────────

// Encrypt a UTF-8 string. Returns the full `.md` payload (banner + base64
// envelope) ready to write to the repo.
export async function encryptNoteContent(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(AES_IV_LENGTH_BYTES)
  crypto.getRandomValues(iv)

  const plaintextBytes = new TextEncoder().encode(plaintext)

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    plaintextBytes as unknown as ArrayBuffer
  )

  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertextBuf)),
  }

  const envelopeJson = JSON.stringify(envelope)
  const envelopeB64 = bytesToBase64(new TextEncoder().encode(envelopeJson))

  return ENCRYPTED_BANNER_OPEN + envelopeB64 + '\n'
}

// Decrypt a noteser-encrypted payload. Throws if the input is malformed or
// the key is wrong (the underlying WebCrypto error bubbles up — AES-GCM
// auth-tag failure throws `OperationError`).
export async function decryptNoteContent(
  maybeCiphertext: string,
  key: CryptoKey
): Promise<string> {
  if (!isEncryptedContent(maybeCiphertext)) {
    throw new Error('vaultCrypto: input is not a noteser-encrypted payload')
  }

  const envelopeB64 = extractEnvelopeBody(maybeCiphertext)
  let envelope: unknown
  try {
    const envelopeJson = new TextDecoder().decode(base64ToBytes(envelopeB64))
    envelope = JSON.parse(envelopeJson)
  } catch {
    throw new Error('vaultCrypto: encrypted envelope is malformed')
  }

  if (!isEnvelope(envelope)) {
    throw new Error('vaultCrypto: encrypted envelope is missing required fields')
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`vaultCrypto: unsupported envelope version ${envelope.v}`)
  }

  const iv = base64ToBytes(envelope.iv)
  const ct = base64ToBytes(envelope.ct)

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    ct as unknown as ArrayBuffer
  )

  return new TextDecoder().decode(plaintextBuf)
}

// ── canary (passphrase verification) ─────────────────────────────────────────

// Known plaintext encrypted into the canary at enable-time. Bumping
// this would invalidate every existing vault's canary — don't.
export const CANARY_PLAINTEXT = 'noteser-vault-canary-v1'

// Build the canary blob to persist alongside the salt + enabled flag.
// Encrypts a fixed plaintext so the unlock UI can verify the passphrase
// locally without needing to round-trip an actual note through pull.
export async function makeCanary(key: CryptoKey): Promise<string> {
  return encryptNoteContent(CANARY_PLAINTEXT, key)
}

// Try to decrypt the stored canary with `key`. Returns true if the
// decryption succeeded AND the plaintext matches CANARY_PLAINTEXT.
// Returns false on any failure (wrong passphrase, malformed canary,
// missing canary). Never throws — wrong-passphrase is the expected
// failure mode and shouldn't surface as an exception to the UI.
export async function verifyCanary(canary: string | null, key: CryptoKey): Promise<boolean> {
  if (!canary) return false
  try {
    const decoded = await decryptNoteContent(canary, key)
    return decoded === CANARY_PLAINTEXT
  } catch {
    return false
  }
}
