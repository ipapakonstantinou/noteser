'use client'

import { useEffect, useRef, useState } from 'react'
import { useUIStore, useSettingsStore, useGitHubStore } from '@/stores'
import { useGitHubSync } from '@/hooks/useGitHubSync'
import { withTokenRefresh } from '@/utils/tokenRefresh'
import { Button } from '@/components/ui'
import {
  Field,
  SettingsCheckbox,
  SettingsTextInput,
} from '../index'
import { PanelHeading } from '../PanelHeading'

export function GitHubPanel() {
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const pullOnlyOnStartup = useSettingsStore(s => s.pullOnlyOnStartup)
  const autoSyncIntervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)
  const setAutoSyncOnStart = useSettingsStore(s => s.setAutoSyncOnStart)
  const setPullOnlyOnStartup = useSettingsStore(s => s.setPullOnlyOnStartup)
  const setAutoSyncIntervalMinutes = useSettingsStore(s => s.setAutoSyncIntervalMinutes)
  const defaultCommitMessage = useSettingsStore(s => s.defaultCommitMessage)
  const setDefaultCommitMessage = useSettingsStore(s => s.setDefaultCommitMessage)
  const settingsFolderPath = useSettingsStore(s => s.settingsFolderPath)
  const setSettingsFolderPath = useSettingsStore(s => s.setSettingsFolderPath)

  return (
    <div className="space-y-4">
      <PanelHeading>GitHub sync</PanelHeading>
      <Field
        label="Auto-sync on startup"
        description="When the app boots and a repo is connected, pull + push once automatically."
      >
        <SettingsCheckbox
          checked={autoSyncOnStart}
          onChange={setAutoSyncOnStart}
        />
      </Field>
      <Field
        label="Pull-only on startup"
        description="When auto-sync runs on boot, only PULL — local edits stay local until you click Commit & Sync. The pending-count chip in the editor footer surfaces unsynced notes. Useful when this device often has work-in-flight you don't want auto-pushed."
      >
        <SettingsCheckbox
          checked={pullOnlyOnStartup}
          onChange={setPullOnlyOnStartup}
        />
      </Field>
      <Field
        label="Auto-sync every"
        description="Minutes between auto-syncs. 0 disables periodic syncing."
      >
        <div className="flex items-center gap-2">
          <SettingsTextInput
            value={String(autoSyncIntervalMinutes)}
            onCommit={(raw) => {
              const n = parseInt(raw, 10)
              const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 1440)
              setAutoSyncIntervalMinutes(clamped)
            }}
            normalize={(raw) => {
              const n = parseInt(raw, 10)
              const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 1440)
              return String(clamped)
            }}
            placeholder="0"
            mono
          />
          <span className="text-sm text-obsidianMuted">min</span>
        </div>
      </Field>
      <Field
        label="Default commit message"
        description='Pre-fills the Source Control commit textarea. Supports {{date}} which is substituted with today&apos;s YYYY-MM-DD (matching daily-note titles) before display. Vault-synced — any device sharing this repo gets the same template.'
      >
        <SettingsTextInput
          value={defaultCommitMessage}
          onCommit={setDefaultCommitMessage}
          placeholder="Sync from Noteser ({{date}})"
          mono
        />
      </Field>
      <Field
        label="Settings folder"
        description="Repo path that holds settings.json. Different paths on different devices keep their settings independent. Empty disables settings sync."
      >
        <SettingsTextInput
          value={settingsFolderPath}
          onCommit={setSettingsFolderPath}
          normalize={(raw) => raw.trim().replace(/^\/+|\/+$/g, '')}
          placeholder=".noteser"
          mono
        />
      </Field>
      <VaultGitignoreField />
      <GitignoreOverlayField />
      <VaultEncryptionField />
      <ResetToRemoteField />
    </div>
  )
}

// Vault encryption controls. Phase B of the backup-encryption feature.
// Surfaces three buttons depending on current state:
//   - Disabled:          [Enable encryption…]
//   - Enabled + locked:  [Unlock…] + [Disable encryption…]
//   - Enabled + unlocked: [Lock now] + [Disable encryption…]
//
// Subscribes to vaultKey's lock listener so the "locked vs unlocked"
// label flips live when sync unlocks the vault behind the scenes (or
// when a remote salt rotation invalidates the in-memory key).
function VaultEncryptionField() {
  const enabled = useSettingsStore(s => s.vaultEncryptionEnabled)
  const openModal = useUIStore(s => s.openModal)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    // Dynamic import keeps the settings panel free of a hard
    // vault-key dep at module load (helps SSR + keeps the
    // Settings → General panel zero-cost).
    let cancelled = false
    let unsub: (() => void) | undefined
    void (async () => {
      const { isVaultUnlocked, onVaultLockChange } = await import('@/utils/vaultKey')
      if (cancelled) return
      setUnlocked(isVaultUnlocked())
      unsub = onVaultLockChange(() => setUnlocked(isVaultUnlocked()))
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  return (
    <Field
      label="Vault encryption"
      description="AES-GCM-encrypt note bodies before pushing to GitHub. Passphrase is never persisted — there is no recovery if you forget it."
    >
      {!enabled ? (
        <button
          type="button"
          onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'enable', returnTo: 'settings' } })}
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
          data-testid="settings-encryption-enable"
        >
          Enable encryption…
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-obsidianSecondaryText" data-testid="settings-encryption-status">
            Status: {unlocked
              ? <span className="text-emerald-300">Enabled and unlocked</span>
              : <span className="text-amber-300">Enabled, vault is locked</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {unlocked ? (
              <button
                type="button"
                onClick={async () => {
                  const { lockVault } = await import('@/utils/vaultKey')
                  lockVault()
                }}
                className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors"
                data-testid="settings-encryption-lock"
              >
                Lock now
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'unlock', returnTo: 'settings' } })}
                className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
                data-testid="settings-encryption-unlock"
              >
                Unlock…
              </button>
            )}
            {/* Change-passphrase entry. Only meaningful once the vault is
                unlocked: the modal verifies the OLD passphrase before
                deriving the new key, so we never end up with a salt
                rotation the user can't undo. */}
            {unlocked && (
              <button
                type="button"
                onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'change', returnTo: 'settings' } })}
                className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors"
                data-testid="settings-encryption-change"
              >
                Change passphrase…
              </button>
            )}
            <button
              type="button"
              onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'confirm-disable', returnTo: 'settings' } })}
              className="px-3 py-1.5 text-sm border border-red-900/40 text-red-300 rounded hover:bg-red-900/20 transition-colors"
              data-testid="settings-encryption-disable"
            >
              Disable encryption…
            </button>
          </div>
        </div>
      )}
    </Field>
  )
}

// Destructive escape hatch: drop local copies of pushed notes and pull
// fresh from the repo. Useful when the user's local state drifted in a
// way they don't want to merge (e.g. corrupted edits, abandoned
// experiment, vault rebuilt elsewhere). Unpushed local notes are kept
// by default; an "also drop unpushed notes" checkbox forces a true
// clean slate.
function ResetToRemoteField() {
  const syncRepo = useGitHubStore(s => s.syncRepo)
  // Reset-to-remote PULLS the remote version; it must never push (pushing
  // here re-sent settings.json + attachments as a surprise commit).
  const { runPullOnly } = useGitHubSync()
  const [confirming, setConfirming] = useState(false)
  const [dropUnpushed, setDropUnpushed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)

  // When the strip opens, scroll it into view. The Settings modal's
  // right pane is independently scrollable, so a long panel can clip
  // the strip's Cancel / Yes-reset buttons below the fold — caught by
  // qa-tester sweep on the deployed preview.
  useEffect(() => {
    if (confirming && confirmRef.current) {
      confirmRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [confirming])

  if (!syncRepo) return null

  const apply = async () => {
    setBusy(true)
    setResultMsg(null)
    try {
      const { resetToRemote } = await import('@/utils/resetToRemote')
      const r = await resetToRemote({ preserveUnpushed: !dropUnpushed })
      // Pull-only — re-create the wiped notes from remote without pushing
      // anything back (reset means "match the remote", not "send local").
      await runPullOnly()
      const kept = r.preserved > 0 ? ` · kept ${r.preserved} local-only` : ''
      setResultMsg(`Reset complete — dropped ${r.pushedDropped} pushed${kept}.`)
    } catch (err) {
      setResultMsg(`Reset failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
      setConfirming(false)
      setDropUnpushed(false)
    }
  }

  return (
    <Field
      label="Reset to remote"
      description="Discard local edits to pushed notes and pull a fresh copy from the repo. Unpushed local notes are kept by default."
    >
      <div className="space-y-2">
        {!confirming ? (
          <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
            Reset local to match remote…
          </Button>
        ) : (
          <div ref={confirmRef} className="space-y-2 p-3 border border-amber-900/40 rounded bg-amber-900/10">
            <div className="text-sm text-amber-200">
              This drops every local note that has a synced path. The next pull will re-create them from the repo. There is no undo.
            </div>
            <label className="flex items-center gap-2 text-sm text-obsidianText">
              <input
                type="checkbox"
                checked={dropUnpushed}
                onChange={e => setDropUnpushed(e.target.checked)}
              />
              Also drop unpushed local notes (true clean slate)
            </label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => { setConfirming(false); setDropUnpushed(false) }} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={apply} disabled={busy} data-testid="reset-to-remote-confirm">
                {busy ? 'Resetting…' : 'Yes, reset'}
              </Button>
            </div>
          </div>
        )}
        {resultMsg && <div className="text-xs text-obsidianSecondaryText">{resultMsg}</div>}
      </div>
    </Field>
  )
}

// In-app editor for the SHARED vault `.gitignore` (the file at the
// repo root). Lets the user fetch the current content on demand, edit
// it inline, and push on the next sync. The fetch button reads from
// GitHub directly so we don't have to wait for a full sync to see
// what's already there.
function VaultGitignoreField() {
  const token = useGitHubStore(s => s.token)
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const draft = useSettingsStore(s => s.vaultGitignoreDraft)
  const snapshot = useSettingsStore(s => s.vaultGitignoreRemoteSnapshot)
  const setDraft = useSettingsStore(s => s.setVaultGitignoreDraft)
  const setSnapshot = useSettingsStore(s => s.setVaultGitignoreRemoteSnapshot)

  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const connected = !!(token && syncRepo)
  // Three UI states:
  //   - never fetched (draft + snapshot both null) → empty textarea + prompt
  //   - fetched + unchanged (draft === snapshot) → editor with no dirty marker
  //   - fetched + dirty (draft !== snapshot) → "Will push on next sync" badge
  const hasContent = draft != null || snapshot != null
  const dirty = draft != null && draft !== (snapshot ?? '')

  const handleFetch = async () => {
    if (!token || !syncRepo) return
    setFetching(true); setFetchError(null)
    try {
      const { fetchRemoteGitignore } = await import('@/utils/gitignoreSync')
      // withTokenRefresh: the read-ref → tree → blob chain inside
      // fetchRemoteGitignore auto-renews an expired token instead of 401-ing.
      const { content } = await withTokenRefresh(tok => fetchRemoteGitignore(tok, syncRepo))
      setSnapshot(content)
      setDraft(content)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setFetching(false)
    }
  }

  const handleDiscard = () => {
    // Snap the textarea back to the last fetched remote content.
    // Clears the dirty marker without losing the snapshot.
    setDraft(snapshot)
  }

  return (
    <Field
      label="Vault .gitignore"
      description="The shared ignore file at the repo root. Fetch the current content, edit, and the next sync pushes your changes. Combined with the local overlay below for matching."
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleFetch}
            disabled={!connected || fetching}
            className="px-2 py-1 text-xs rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianText hover:border-obsidianAccentPurple disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="vault-gitignore-fetch"
          >
            {fetching ? 'Fetching…' : (hasContent ? 'Refetch from sync repo' : 'Fetch from sync repo')}
          </button>
          {dirty && (
            <span className="text-[11px] uppercase tracking-wide text-obsidianAccentPurple" data-testid="vault-gitignore-dirty">
              Will push on next sync
            </span>
          )}
          {dirty && (
            <button
              type="button"
              onClick={handleDiscard}
              className="text-xs text-obsidianSecondaryText hover:text-obsidianText underline"
              data-testid="vault-gitignore-discard"
            >
              Discard
            </button>
          )}
          {!connected && (
            <span className="text-xs text-obsidianSecondaryText">Connect a sync repo to enable.</span>
          )}
          {fetchError && (
            <span className="text-xs text-red-400" data-testid="vault-gitignore-error">{fetchError}</span>
          )}
        </div>
        <textarea
          value={draft ?? snapshot ?? ''}
          onChange={e => setDraft(e.target.value)}
          placeholder={hasContent ? '' : '# Click "Fetch from sync repo" to load the current .gitignore'}
          rows={6}
          spellCheck={false}
          disabled={!connected}
          className="w-full px-2 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple font-mono resize-y disabled:opacity-50"
          data-testid="vault-gitignore-textarea"
        />
      </div>
    </Field>
  )
}

// Editable local .gitignore overlay. Per-DEVICE — combined with the
// remote vault `.gitignore` at sync time so the user can add personal
// ignores (e.g. scratch files) without touching the shared file.
// The shared file itself is edited via VaultGitignoreField above.
function GitignoreOverlayField() {
  const overlay = useSettingsStore(s => s.localGitignoreOverlay)
  const setOverlay = useSettingsStore(s => s.setLocalGitignoreOverlay)
  // Local draft so the textarea can render multi-line without the
  // SettingsTextInput's commit-on-blur dance — we save on every
  // keystroke via the store directly (cheap; it's a tiny string).
  return (
    <Field
      label="Local ignore patterns"
      description="Per-device additions to the vault's .gitignore — combined at sync time. One pattern per line. Useful for personal scratch files you don't want anyone else to see. Use a leading ! to un-ignore a remote rule."
    >
      <textarea
        value={overlay}
        onChange={e => setOverlay(e.target.value)}
        placeholder={'# extras only on this device\n*.scratch\n!important.scratch'}
        rows={5}
        spellCheck={false}
        className="w-full px-2 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple font-mono resize-y"
        data-testid="local-gitignore-overlay"
      />
    </Field>
  )
}
