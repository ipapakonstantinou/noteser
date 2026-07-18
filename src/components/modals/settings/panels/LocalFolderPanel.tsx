'use client'

import { useEffect, useState } from 'react'
import { useUIStore, useGitHubStore, useLocalFolderStore, useNoteStore } from '@/stores'
import { PanelHeading } from '../PanelHeading'

// Local folder sync (File System Access API — Chromium only). Pick a
// directory, then push the vault to it / import from it on demand. No
// auto-mirror for v1 — pushes happen via the buttons here so the user
// can keep the model in their head. The handle is persisted in IDB
// (see `localFolderSync.ts`); permission re-prompts once per session.
export function LocalFolderPanel() {
  const status = useLocalFolderStore(s => s.status)
  const folderName = useLocalFolderStore(s => s.folderName)
  const lastSyncedAt = useLocalFolderStore(s => s.lastSyncedAt)
  const busy = useLocalFolderStore(s => s.busy)
  const lastError = useLocalFolderStore(s => s.lastError)
  const setStatus = useLocalFolderStore(s => s.setStatus)
  const setHandle = useLocalFolderStore(s => s.setHandle)
  const setBusy = useLocalFolderStore(s => s.setBusy)
  const recordSync = useLocalFolderStore(s => s.recordSync)
  const setLastError = useLocalFolderStore(s => s.setLastError)
  const openModal = useUIStore(s => s.openModal)

  // Boot: detect support + try to re-acquire a previously-saved handle.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { isLocalFolderSupported, loadLocalFolderHandle } = await import('@/utils/localFolderSync')
      if (cancelled) return
      if (!isLocalFolderSupported()) {
        setStatus('unsupported')
        return
      }
      const saved = await loadLocalFolderHandle()
      if (cancelled) return
      if (saved) {
        setHandle(saved, saved.name)
        setStatus('reconnecting')
      } else {
        setStatus('idle')
      }
    })()
    return () => { cancelled = true }
  }, [setStatus, setHandle])

  const handleConnect = async () => {
    setLastError(null)
    try {
      const { pickLocalFolder, saveLocalFolderHandle } = await import('@/utils/localFolderSync')
      const handle = await pickLocalFolder()
      await saveLocalFolderHandle(handle)
      setHandle(handle, handle.name)
      setStatus('connected')
    } catch (err) {
      // User-cancel raises AbortError; treat that as silent. Other
      // errors get surfaced.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.toLowerCase().includes('abort')) {
        setLastError(msg)
      }
    }
  }

  const handleReconnect = async () => {
    setLastError(null)
    const { ensureFolderPermission } = await import('@/utils/localFolderSync')
    const handle = useLocalFolderStore.getState().handle
    if (!handle) return
    const granted = await ensureFolderPermission(handle)
    if (granted) {
      setStatus('connected')
    } else {
      setStatus('denied')
      setLastError('Permission denied. Click Reconnect to try again.')
    }
  }

  const handlePushToFolder = async () => {
    const handle = useLocalFolderStore.getState().handle
    if (!handle) return
    setBusy(true)
    setLastError(null)
    try {
      const { pushNotesToFolder, ensureFolderPermission } = await import('@/utils/localFolderSync')
      const granted = await ensureFolderPermission(handle)
      if (!granted) {
        setLastError('Permission denied.')
        setStatus('denied')
        return
      }
      await pushNotesToFolder(handle, useNoteStore.getState().notes)
      recordSync()
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusy(false)
    }
  }

  const handleImport = () => openModal({ type: 'local-folder-import' })

  const handleDisconnect = async () => {
    const { clearLocalFolderHandle } = await import('@/utils/localFolderSync')
    await clearLocalFolderHandle()
    setHandle(null, null)
    setStatus('idle')
  }

  return (
    <div className="space-y-4">
      <PanelHeading>Local folder sync</PanelHeading>

      <p className="text-sm text-obsidianSecondaryText">
        Mirror your vault to a folder on disk (Obsidian-style local vault). Edit notes in another
        editor and re-import; push the current vault out to a folder for backup. If the folder is
        a git repo, the In-folder git section below handles init / commit / push directly from
        noteser.
      </p>

      {status === 'unsupported' && (
        <div className="flex items-start gap-2 p-3 rounded-sm bg-amber-900/20 border border-amber-900/40 text-amber-200 text-xs">
          <ExclamationTriangleIconUnsupported />
          <span>
            Your browser doesn&apos;t support the File System Access API. Use Chrome / Edge / Brave /
            Arc, or wait for the desktop build.
          </span>
        </div>
      )}

      {(status === 'idle' || status === 'denied') && (
        <button
          type="button"
          onClick={handleConnect}
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded-sm hover:bg-obsidianAccentPurple/25 transition-colors"
          data-testid="local-folder-connect"
        >
          Connect a folder…
        </button>
      )}

      {status === 'reconnecting' && (
        <div className="space-y-2">
          <div className="text-xs text-obsidianSecondaryText">
            Previously connected to <span className="text-obsidianText font-mono">{folderName}</span>.
            Reconnect to grant permission again for this session.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReconnect}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded-sm hover:bg-obsidianAccentPurple/25 transition-colors"
              data-testid="local-folder-reconnect"
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianSecondaryText rounded-sm hover:text-obsidianText hover:bg-obsidianHighlight transition-colors"
            >
              Forget folder
            </button>
          </div>
        </div>
      )}

      {status === 'connected' && (
        <div className="space-y-3" data-testid="local-folder-connected">
          <div className="text-xs text-obsidianSecondaryText">
            Connected: <span className="text-obsidianText font-mono">{folderName}</span>
            {lastSyncedAt && (
              <> &middot; last synced {new Date(lastSyncedAt).toLocaleTimeString()}</>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePushToFolder}
              disabled={busy}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded-sm hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
              data-testid="local-folder-push"
            >
              {busy ? 'Working…' : 'Push vault to folder'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded-sm hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
              data-testid="local-folder-import-open"
            >
              Sync from folder…
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-red-900/40 text-red-300 rounded-sm hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {lastError && (
        <div className="text-xs text-red-300 p-2 rounded-sm border border-red-900/40 bg-red-900/20">
          {lastError}
        </div>
      )}

      {status === 'connected' && <InFolderGitSection />}
    </div>
  )
}

// In-folder git operations — only renders when the user has a connected
// local folder. Owns its own state machine: not-a-repo / no-remote /
// ready (repo + remote + token). Pure UI shell around the helpers in
// `src/utils/inBrowserGit.ts`.
function InFolderGitSection() {
  const handle = useLocalFolderStore(s => s.handle)
  const token = useGitHubStore(s => s.token)
  const user = useGitHubStore(s => s.user)
  const [isRepoNow, setIsRepoNow] = useState<boolean | null>(null)
  const [remote, setRemote] = useState<string | null>(null)
  const [remoteDraft, setRemoteDraft] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busyStep, setBusyStep] = useState<null | 'init' | 'remote' | 'commit' | 'push'>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ modified: number; untracked: number; deleted: number } | null>(null)

  // Detect repo state + remote whenever the connected folder changes.
  useEffect(() => {
    if (!handle) return
    let cancelled = false
    setError(null)
    setIsRepoNow(null)
    setStatus(null)
    void (async () => {
      try {
        const { isRepo, getRemoteUrl, summarizeStatus } = await import('@/utils/inBrowserGit')
        const repo = await isRepo(handle)
        if (cancelled) return
        setIsRepoNow(repo)
        if (repo) {
          const url = await getRemoteUrl(handle)
          if (cancelled) return
          setRemote(url)
          setRemoteDraft(url ?? '')
          try {
            const s = await summarizeStatus(handle)
            if (!cancelled) {
              setStatus({
                modified: s.modified.length,
                untracked: s.untracked.length,
                deleted: s.deleted.length,
              })
            }
          } catch {
            // statusMatrix can fail on a fresh init with no commits;
            // that's fine — we just don't show the counts yet.
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Git inspect failed')
      }
    })()
    return () => { cancelled = true }
  }, [handle])

  if (!handle) return null

  const handleInit = async () => {
    setBusyStep('init')
    setError(null)
    try {
      const { initRepo } = await import('@/utils/inBrowserGit')
      await initRepo({ root: handle })
      setIsRepoNow(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Init failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handleSetRemote = async () => {
    setBusyStep('remote')
    setError(null)
    try {
      const { setRemoteUrl } = await import('@/utils/inBrowserGit')
      await setRemoteUrl(handle, remoteDraft.trim())
      setRemote(remoteDraft.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Set remote failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    setBusyStep('commit')
    setError(null)
    try {
      const { stageAll, commit, summarizeStatus } = await import('@/utils/inBrowserGit')
      await stageAll({ root: handle })
      await commit({
        root: handle,
        message: commitMsg.trim(),
        author: {
          name: user?.name || user?.login || 'Noteser User',
          email: user?.login ? `${user.login}@users.noreply.github.com` : 'noteser@example.com',
        },
      })
      setCommitMsg('')
      const s = await summarizeStatus(handle)
      setStatus({ modified: s.modified.length, untracked: s.untracked.length, deleted: s.deleted.length })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handlePush = async () => {
    if (!token) {
      setError('Connect GitHub (Settings → GitHub sync) first — push needs your OAuth token.')
      return
    }
    setBusyStep('push')
    setError(null)
    try {
      const { push } = await import('@/utils/inBrowserGit')
      await push({ root: handle, token })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusyStep(null)
    }
  }

  const busy = busyStep != null

  return (
    <div className="space-y-3 mt-2 pt-4 border-t border-obsidianBorder" data-testid="in-folder-git">
      <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
        In-folder git
      </div>

      {isRepoNow === null && (
        <div className="text-xs text-obsidianSecondaryText italic">Inspecting folder…</div>
      )}

      {isRepoNow === false && (
        <div className="space-y-2">
          <p className="text-xs text-obsidianSecondaryText">
            Not a git repo yet. Initialise it to start tracking commits from inside noteser.
          </p>
          <button
            type="button"
            onClick={handleInit}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded-sm hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
            data-testid="in-folder-git-init"
          >
            {busyStep === 'init' ? 'Initialising…' : 'Initialise git repo'}
          </button>
        </div>
      )}

      {isRepoNow === true && (
        <div className="space-y-3">
          <div className="text-xs text-obsidianSecondaryText">
            {status
              ? `Status: ${status.modified} modified · ${status.untracked} new · ${status.deleted} deleted`
              : 'No status yet (no commits in this repo).'}
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
              Remote (origin)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={remoteDraft}
                onChange={e => setRemoteDraft(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="flex-1 px-2 py-1 text-xs font-mono bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:border-obsidianAccentPurple"
                data-testid="in-folder-git-remote-input"
              />
              <button
                type="button"
                onClick={handleSetRemote}
                disabled={busy || remoteDraft.trim() === (remote ?? '')}
                className="px-3 py-1 text-xs border border-obsidianBorder text-obsidianText rounded-sm hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
                data-testid="in-folder-git-set-remote"
              >
                {busyStep === 'remote' ? 'Setting…' : 'Set'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
              Commit message
            </label>
            <textarea
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="Describe what changed…"
              rows={2}
              className="w-full px-2 py-1 text-xs font-mono bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:border-obsidianAccentPurple resize-none"
              data-testid="in-folder-git-commit-message"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy || !commitMsg.trim()}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded-sm hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
              data-testid="in-folder-git-commit"
            >
              {busyStep === 'commit' ? 'Committing…' : 'Commit'}
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={busy || !remote}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded-sm hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
              title={remote ? '' : 'Set a remote first'}
              data-testid="in-folder-git-push"
            >
              {busyStep === 'push' ? 'Pushing…' : 'Push to origin'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 p-2 rounded-sm border border-red-900/40 bg-red-900/20">
          {error}
        </div>
      )}
    </div>
  )
}

const ExclamationTriangleIconUnsupported = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 shrink-0 mt-0.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>
)
