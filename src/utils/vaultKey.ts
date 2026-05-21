// In-memory holder for the derived vault encryption key.
//
// The passphrase is never persisted. The derived CryptoKey lives only in
// this module's closure — cleared on lockVault(), gone on page refresh.
// Callers should call `unlockVault(passphrase)` once when the user
// types their passphrase, then `getVaultKey()` from the sync codepath.
//
// The settings store holds the salt + enabled flag (vault-synced via
// settings.json). This module mediates between user-facing
// "passphrase" and the WebCrypto key the sync layer needs.

import { deriveKey, saltFromString } from './vaultCrypto'
import type { SettingsState } from '@/stores/settingsStore'

interface KeyHolder {
  key: CryptoKey | null
  // The saltBase64 + passphrase hash that produced this key, so a salt
  // rotation invalidates the cached key automatically.
  saltKey: string | null
}

const holder: KeyHolder = { key: null, saltKey: null }
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) {
    try { l() } catch { /* listener errors must not break the sync */ }
  }
}

/** True when the vault is currently unlocked (key is in memory). */
export function isVaultUnlocked(): boolean {
  return holder.key !== null
}

/** The active vault key, or null when locked. */
export function getVaultKey(): CryptoKey | null {
  return holder.key
}

/**
 * Derive the AES-GCM key from a passphrase + the vault's stored salt.
 * Resolves true when the key was derived; false when the salt is missing
 * (encryption not yet set up). Throws only if the underlying WebCrypto
 * primitive errors — that's a runtime bug, not a wrong-passphrase
 * situation (wrong passphrase produces a key that simply fails to
 * decrypt later).
 */
export async function unlockVault(passphrase: string, saltBase64: string): Promise<boolean> {
  if (!saltBase64) return false
  const salt = saltFromString(saltBase64)
  const key = await deriveKey(passphrase, salt)
  holder.key = key
  holder.saltKey = saltBase64
  notify()
  return true
}

/** Clear the in-memory key. Idempotent. */
export function lockVault(): void {
  if (holder.key === null) return
  holder.key = null
  holder.saltKey = null
  notify()
}

/**
 * If the vault's salt has changed (e.g. a remote sync brought in a new
 * vault-settings file whose salt differs from what we unlocked with),
 * the cached key is now wrong. Call this after applying remote vault
 * settings — it locks the vault if the salt rotated, leaving it
 * unlocked when the salt is unchanged.
 */
export function invalidateKeyIfSaltChanged(currentSalt: string | null): void {
  if (holder.key == null) return
  if (holder.saltKey === currentSalt) return
  lockVault()
}

/** Subscribe to lock/unlock transitions. Returns the unsubscribe fn. */
export function onVaultLockChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test hook. Clears state without firing listeners. */
export function _resetVaultKeyForTests(): void {
  holder.key = null
  holder.saltKey = null
  listeners.clear()
}

/**
 * Thrown by the sync layer when an operation needs an unlocked vault
 * but the user hasn't supplied a passphrase yet. The UI catches this
 * to pop the unlock modal.
 */
export class VaultLockedError extends Error {
  constructor(message = 'Vault is encrypted but no key is loaded') {
    super(message)
    this.name = 'VaultLockedError'
  }
}
