'use client'

import { useEffect, useState } from 'react'
import {
  LockClosedIcon,
  LockOpenIcon,
  ExclamationTriangleIcon,
  KeyIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useSettingsStore } from '@/stores'
import {
  generateSalt,
  saltToString,
  makeCanary,
} from '@/utils/vaultCrypto'
import {
  unlockVault,
  verifyAndUnlockVault,
  lockVault,
} from '@/utils/vaultKey'
import { deriveKey } from '@/utils/vaultCrypto'

// Vault encryption UI — Phase B of the backup-encryption feature.
// Phase A shipped the crypto module + push/pull integration; this is
// the user-facing surface for enabling, unlocking, locking, and
// disabling vault encryption.
//
// Three modes, all driven by `data: { mode }` passed via openModal:
//   - 'enable'         — first-time setup. Asks for a new passphrase
//                        twice, generates a salt, encrypts a canary,
//                        and writes salt + canary to settings.
//   - 'unlock'         — vault is already enabled but no key in memory
//                        (every page refresh re-locks; that's by
//                        design — the key lives only in vaultKey's
//                        closure). Verifies passphrase against the
//                        stored canary before committing the key.
//   - 'confirm-disable' — confirms before turning encryption off. The
//                        next push will write plaintext; existing
//                        remote blobs stay encrypted until overwritten.
//
// The passphrase is NEVER persisted. There is NO recovery path. The
// modal repeats this warning at enable time.

const MIN_PASSPHRASE_LENGTH = 12

interface VaultEncryptionModalData {
  mode: 'enable' | 'unlock' | 'confirm-disable'
  // When set, the close handler re-opens that modal type instead of
  // leaving the user staring at the editor. Used by Settings → GitHub
  // sync's encryption row so the user lands back in Settings after
  // their sub-flow completes (qa-tester feedback: the abrupt exit
  // felt broken). Auto-prompt callers (lock-on-startup, sync errors)
  // pass nothing and close cleanly.
  returnTo?: 'settings'
}

export const VaultEncryptionModal = () => {
  const { modal, closeModal, openModal } = useUIStore()
  const data = modal.data as VaultEncryptionModalData | undefined
  const isOpen = modal.type === 'vault-encryption'
  const mode = data?.mode ?? 'unlock'
  const returnTo = data?.returnTo

  // Close handler that respects `returnTo`. Defined once at the
  // component level so every branch below uses the same exit logic.
  const dismiss = () => {
    if (returnTo === 'settings') {
      openModal({ type: 'settings' })
    } else {
      closeModal()
    }
  }

  const salt = useSettingsStore(s => s.vaultEncryptionSalt)
  const canary = useSettingsStore(s => s.vaultEncryptionCanary)
  const setVaultEncryption = useSettingsStore(s => s.setVaultEncryption)

  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset all fields whenever the modal re-opens. Important for
  // security — we don't want a stale passphrase sitting in component
  // state if the user opens, closes, and reopens.
  useEffect(() => {
    if (!isOpen) return
    setPassphrase('')
    setConfirm('')
    setError(null)
    setBusy(false)
  }, [isOpen, mode])

  if (!isOpen) return null

  // ── enable ──────────────────────────────────────────────────────────────
  if (mode === 'enable') {
    const valid =
      passphrase.length >= MIN_PASSPHRASE_LENGTH &&
      passphrase === confirm

    const handleEnable = async () => {
      if (!valid) return
      setBusy(true)
      setError(null)
      try {
        const newSalt = generateSalt()
        const saltStr = saltToString(newSalt)
        const key = await deriveKey(passphrase, newSalt)
        const newCanary = await makeCanary(key)
        // Persist before flipping the enabled bit — if the canary
        // write fails (it shouldn't; deriveKey is the only async
        // part that can fail), we don't end up with enabled=true
        // and canary=null.
        setVaultEncryption(true, saltStr, newCanary)
        // Cache the key in memory so the next sync push works
        // without prompting again.
        await unlockVault(passphrase, saltStr)
        dismiss()
      } catch (err) {
        setError(`Couldn't enable encryption: ${(err as Error).message}`)
      } finally {
        setBusy(false)
      }
    }

    return (
      <Modal isOpen={isOpen} onClose={dismiss} title="Enable vault encryption" size="md">
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 p-3 rounded bg-amber-900/20 border border-amber-900/40 text-amber-200">
            <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-medium">Read this first.</div>
              <ul className="list-disc pl-4 space-y-0.5 text-amber-200/80">
                <li>Your passphrase is never stored anywhere.</li>
                <li><span className="font-medium text-amber-200">There is no recovery</span> if you forget it.</li>
                <li>Use a password manager.</li>
                <li>Every push from this point on encrypts note bodies before they reach GitHub.</li>
              </ul>
            </div>
          </div>

          <PassphraseField
            label="New passphrase"
            value={passphrase}
            onChange={setPassphrase}
            placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
            autoFocus
            data-testid="vault-encryption-passphrase"
          />
          <PassphraseField
            label="Confirm passphrase"
            value={confirm}
            onChange={setConfirm}
            placeholder="Type it again"
            data-testid="vault-encryption-confirm"
          />
          {passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH && (
            <div className="text-xs text-obsidianSecondaryText">
              {MIN_PASSPHRASE_LENGTH - passphrase.length} more character(s) needed.
            </div>
          )}
          {passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm.length > 0 && passphrase !== confirm && (
            <div className="text-xs text-red-300">Passphrases don&apos;t match.</div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={dismiss} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleEnable}
              disabled={!valid || busy}
              data-testid="vault-encryption-enable-submit"
            >
              <KeyIcon className="w-4 h-4" />
              {busy ? 'Enabling…' : 'Enable encryption'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── unlock ──────────────────────────────────────────────────────────────
  if (mode === 'unlock') {
    const handleUnlock = async () => {
      if (!salt) {
        setError('Vault is missing its encryption salt — re-enable encryption in Settings → GitHub sync.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const ok = await verifyAndUnlockVault(passphrase, salt, canary)
        if (!ok) {
          setError('Wrong passphrase. Try again.')
          return
        }
        dismiss()
      } catch (err) {
        setError(`Unlock failed: ${(err as Error).message}`)
      } finally {
        setBusy(false)
      }
    }

    return (
      <Modal isOpen={isOpen} onClose={dismiss} title="Unlock vault" size="md">
        <div className="space-y-4 text-sm">
          <p className="text-obsidianSecondaryText">
            This vault is encrypted. Enter your passphrase to unlock it — the key
            stays in memory until the page is refreshed.
          </p>
          <PassphraseField
            label="Passphrase"
            value={passphrase}
            onChange={setPassphrase}
            placeholder="Your vault passphrase"
            autoFocus
            data-testid="vault-encryption-unlock-passphrase"
            onSubmit={handleUnlock}
          />
          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <details className="text-xs text-obsidianSecondaryText">
            <summary className="cursor-pointer hover:text-obsidianText">I forgot my passphrase</summary>
            <p className="mt-2 leading-relaxed">
              No recovery is available — the passphrase isn&apos;t stored anywhere.
              You can disable encryption (Settings → GitHub sync) and re-enable
              with a new passphrase, but the existing encrypted notes on remote
              will become unreadable.
            </p>
          </details>
          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={dismiss} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleUnlock}
              disabled={passphrase.length === 0 || busy}
              data-testid="vault-encryption-unlock-submit"
            >
              <LockOpenIcon className="w-4 h-4" />
              {busy ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── confirm-disable ─────────────────────────────────────────────────────
  const handleDisable = () => {
    // Clear all three encryption fields together so we never end up in
    // a half-enabled state (enabled=false but salt still set, etc.).
    setVaultEncryption(false, null, null)
    lockVault()
    dismiss()
  }

  return (
    <Modal isOpen={isOpen} onClose={dismiss} title="Disable vault encryption" size="md">
      <div className="space-y-4 text-sm">
        <div className="flex items-start gap-2 p-3 rounded bg-amber-900/20 border border-amber-900/40 text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <div className="font-medium">Heads up.</div>
            <ul className="list-disc pl-4 space-y-0.5 text-amber-200/80">
              <li>Future pushes will write plaintext to GitHub.</li>
              <li>Existing encrypted blobs on remote stay encrypted until you overwrite them (typically next time you edit + push that note).</li>
              <li>If you can&apos;t unlock the vault to read existing remote blobs, the encrypted content is effectively lost.</li>
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
          <Button variant="ghost" onClick={dismiss}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleDisable}
            data-testid="vault-encryption-disable-confirm"
          >
            <LockClosedIcon className="w-4 h-4" />
            Disable encryption
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type PassphraseFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  label: string
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
}

const PassphraseField = ({
  label, value, onChange, placeholder, autoFocus, onSubmit, ...rest
}: PassphraseFieldProps) => (
  <label className="block">
    <span className="block text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1">{label}</span>
    <input
      type="password"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={e => {
        if (e.key === 'Enter' && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
      }}
      className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
      autoComplete="new-password"
      {...rest}
    />
  </label>
)

export default VaultEncryptionModal
