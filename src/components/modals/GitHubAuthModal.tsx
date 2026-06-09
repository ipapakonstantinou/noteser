'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { Modal, Button, Input } from '@/components/ui'
import { useUIStore, useGitHubStore } from '@/stores'
import { startDeviceFlow, pollForToken, fetchGitHubUserAndScopes, DeviceFlowError, type DeviceFlowStart } from '@/utils/github'

type Status =
  | { kind: 'requesting' }
  | { kind: 'waiting'; device: DeviceFlowStart }
  | { kind: 'success'; login: string }
  | { kind: 'error'; message: string }

const PAT_DOCS_URL = 'https://github.com/settings/personal-access-tokens'

export const GitHubAuthModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const openModal = useUIStore(s => s.openModal)
  const setSession = useGitHubStore((s) => s.setSession)
  const syncRepo = useGitHubStore((s) => s.syncRepo)

  const isOpen = modal.type === 'github-auth'
  const [status, setStatus] = useState<Status>({ kind: 'requesting' })
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Alternative sign-in path: a user can paste a fine-grained PAT scoped to
  // just their vault repo (Contents: read+write) instead of running the broad
  // `repo`-scoped device flow. Default stays the one-click device flow; this
  // is revealed only when `usePat` is toggled on.
  const [usePat, setUsePat] = useState(false)
  const [patValue, setPatValue] = useState('')
  const [patError, setPatError] = useState<string | null>(null)
  const [patSubmitting, setPatSubmitting] = useState(false)

  // Run the device flow whenever the modal opens; cancel on close.
  useEffect(() => {
    if (!isOpen) return
    // Reset the PAT sub-form to its default (hidden) state each open so the
    // device flow remains the default experience.
    setUsePat(false)
    setPatValue('')
    setPatError(null)
    setPatSubmitting(false)
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'requesting' })
    setCopied(false)
    ;(async () => {
      try {
        const device = await startDeviceFlow()
        if (controller.signal.aborted) return
        setStatus({ kind: 'waiting', device })
        const tokenSet = await pollForToken({
          deviceCode: device.device_code,
          interval: device.interval,
          expiresIn: device.expires_in,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        // Capture the token's OAuth scopes alongside the user so the
        // gist-publish path can tell whether the user has already
        // authorised `gist` (avoids a redundant scope-upgrade prompt
        // for users who happen to have a wider token from elsewhere).
        const { user, scopes } = await fetchGitHubUserAndScopes(tokenSet.accessToken)
        if (controller.signal.aborted) return
        // Persist the FULL token set (access + refresh + expiries) so the
        // renewal layer can silently refresh an expiring token. For a
        // non-expiring token the extra fields are null and behaviour is
        // unchanged.
        setSession(tokenSet.accessToken, user, scopes, tokenSet)
        setStatus({ kind: 'success', login: user.login })
        // Brief success view, then chain into the repo picker (or just close
        // if the user already has a sync repo from a previous session).
        setTimeout(() => {
          if (controller.signal.aborted) return
          if (syncRepo) closeModal()
          else openModal({ type: 'github-repo' })
        }, 1200)
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DeviceFlowError) {
          if (err.code === 'aborted') return
          setStatus({ kind: 'error', message: err.message })
        } else {
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
        }
      }
    })()
    return () => {
      controller.abort()
      abortRef.current = null
    }
  // closeModal/setSession are stable Zustand refs; safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleClose = () => {
    abortRef.current?.abort()
    closeModal()
  }

  const handleRetry = () => {
    abortRef.current?.abort()
    // Toggle via setStatus to trigger the effect path; closeModal+reopen would also work.
    setStatus({ kind: 'requesting' })
    const controller = new AbortController()
    abortRef.current = controller
    ;(async () => {
      try {
        const device = await startDeviceFlow()
        if (controller.signal.aborted) return
        setStatus({ kind: 'waiting', device })
        const tokenSet = await pollForToken({
          deviceCode: device.device_code,
          interval: device.interval,
          expiresIn: device.expires_in,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const { user, scopes } = await fetchGitHubUserAndScopes(tokenSet.accessToken)
        setSession(tokenSet.accessToken, user, scopes, tokenSet)
        setStatus({ kind: 'success', login: user.login })
        setTimeout(() => { if (!controller.signal.aborted) closeModal() }, 1200)
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setStatus({ kind: 'error', message })
      }
    })()
  }

  // Reveal the PAT sub-form. Abort the in-flight device-flow polling so the
  // two paths can't both resolve and race on setSession.
  const handleShowPat = () => {
    abortRef.current?.abort()
    setUsePat(true)
    setPatError(null)
  }

  // Return to the default device flow, restarting it (the poll we aborted in
  // handleShowPat is gone).
  const handleHidePat = () => {
    setUsePat(false)
    setPatError(null)
    handleRetry()
  }

  // Validate a pasted fine-grained PAT by fetching the user with it, exactly
  // like the device flow does after polling. On success we route the token
  // through the SAME setSession path, so the rest of the app is identical
  // whether the token came from OAuth or a pasted PAT.
  //
  // SECURITY NOTE: a pasted PAT is persisted in localStorage exactly like the
  // OAuth token (see githubStore). Same trust model — this is expected.
  const handlePatSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = patValue.trim()
    if (!token || patSubmitting) return
    setPatSubmitting(true)
    setPatError(null)
    try {
      // Fine-grained PATs don't carry X-OAuth-Scopes (scopes come back null),
      // which setSession already handles as "unknown" — the gist-publish path
      // falls back to its best-effort attempt. That's correct here.
      const { user, scopes } = await fetchGitHubUserAndScopes(token)
      setSession(token, user, scopes)
      setStatus({ kind: 'success', login: user.login })
      setTimeout(() => {
        if (syncRepo) closeModal()
        else openModal({ type: 'github-repo' })
      }, 1200)
    } catch {
      setPatError('That token did not work — check it has Contents access to your vault repo.')
    } finally {
      setPatSubmitting(false)
    }
  }

  // Anchor's default click opens the new tab without tripping popup blockers.
  // We piggyback on the same click to copy synchronously (no await before the
  // browser sees the navigation intent).
  const handleAnchorClick = () => {
    if (status.kind !== 'waiting') return
    try {
      navigator.clipboard.writeText(status.device.user_code).then(
        () => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        },
        () => { /* clipboard unavailable; tab still opens */ },
      )
    } catch {
      // Older browsers without the Clipboard API — the tab still opens.
    }
  }

  // When the PAT sub-form is open it replaces the device-flow views (but not
  // the terminal success/error views, which the PAT path drives too).
  const showDeviceViews = !usePat

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Connect to GitHub" size="md">
      {showDeviceViews && status.kind === 'requesting' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="animate-spin h-8 w-8 border-2 border-obsidianAccentPurple border-t-transparent rounded-full" />
            <p className="text-sm text-obsidianSecondaryText">Requesting a device code from GitHub…</p>
          </div>
          <PatToggleLink onClick={handleShowPat} />
        </div>
      )}

      {showDeviceViews && status.kind === 'waiting' && (
        <div className="space-y-4">
          <p className="text-sm text-obsidianSecondaryText">
            Copy the code and paste it on GitHub to authorize Noteser. This window will update automatically.
          </p>

          <div className="bg-obsidianDarkGray border border-obsidianBorder rounded-md p-3 text-center">
            <code className="text-2xl font-mono tracking-[0.25em] text-obsidianText select-all">
              {status.device.user_code}
            </code>
          </div>

          <a
            href={status.device.verification_uri}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleAnchorClick}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-obsidianAccentPurple text-white rounded text-sm hover:bg-opacity-90 transition-colors no-underline"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            {copied ? 'Code copied — Opening GitHub…' : 'Copy code & Open GitHub'}
          </a>

          <div className="flex items-center gap-2 text-xs text-obsidianSecondaryText pt-2">
            <div className="animate-pulse h-2 w-2 bg-obsidianAccentPurple rounded-full" />
            Waiting for authorization…
          </div>

          <PatToggleLink onClick={handleShowPat} />
        </div>
      )}

      {usePat && status.kind !== 'success' && (
        <form className="space-y-4" onSubmit={handlePatSubmit}>
          <p className="text-sm text-obsidianSecondaryText">
            Create a fine-grained token in GitHub → Settings → Developer settings, scoped to your vault
            repo with Contents: read and write, then paste it here.
          </p>

          <a
            href={PAT_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-obsidianAccentPurple hover:underline"
          >
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            Open GitHub token settings
          </a>

          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_…"
            value={patValue}
            onChange={(e) => { setPatValue(e.target.value); setPatError(null) }}
            error={patError ?? undefined}
            data-testid="github-pat-input"
            autoFocus
          />

          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={handleHidePat}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={patSubmitting}
              disabled={!patValue.trim()}
              data-testid="github-pat-submit"
            >
              Connect with token
            </Button>
          </div>
        </form>
      )}

      {status.kind === 'success' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircleIcon className="w-10 h-10 text-green-500" />
          <p className="text-sm text-obsidianText">Connected as <strong>@{status.login}</strong></p>
        </div>
      )}

      {showDeviceViews && status.kind === 'error' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/40 rounded">
            <ExclamationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{status.message}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button variant="primary" onClick={handleRetry}>Try again</Button>
          </div>
          <PatToggleLink onClick={handleShowPat} />
        </div>
      )}
    </Modal>
  )
}

// Secondary sign-in affordance: reveals the fine-grained PAT sub-form. Kept as
// a small subcomponent so it can sit under each device-flow view identically.
const PatToggleLink = ({ onClick }: { onClick: () => void }) => (
  <div className="pt-2 border-t border-obsidianBorder text-center">
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-obsidianSecondaryText hover:text-obsidianText underline mt-2"
      data-testid="github-pat-toggle"
    >
      Use a personal access token instead
    </button>
  </div>
)

export default GitHubAuthModal
