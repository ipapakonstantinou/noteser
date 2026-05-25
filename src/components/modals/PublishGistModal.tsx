'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  LockClosedIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useNoteStore, useGitHubStore } from '@/stores'
import { hasGistScope } from '@/stores/githubStore'
import { publishGist, GistScopeError, sanitizeGistFilename } from '@/utils/githubGist'
import {
  startDeviceFlow,
  pollForToken,
  fetchGitHubUserAndScopes,
  DeviceFlowError,
  type DeviceFlowStart,
} from '@/utils/github'

// Publish-as-gist surface for a single note. Open via:
//   useUIStore.openModal({ type: 'publish-gist', data: { noteId } })
//
// We always publish a FRESH gist — there is no concept of "update this
// note's existing gist" yet. That's a feature you'd want eventually but
// it requires storing the gist id alongside the note, which then
// invites the same sync-divergence question the github vault sync
// already deals with. Keep this simple for v1.

interface PublishGistData {
  noteId: string
}

export const PublishGistModal = () => {
  const { modal, closeModal } = useUIStore()
  const data = modal.data as PublishGistData | undefined
  const isOpen = modal.type === 'publish-gist'

  const note = useNoteStore(s => data ? s.notes.find(n => n.id === data.noteId) : undefined)
  const token = useGitHubStore(s => s.token)
  const tokenScopes = useGitHubStore(s => s.tokenScopes)
  const setSession = useGitHubStore(s => s.setSession)

  const [isPublic, setIsPublic] = useState(false)
  const [description, setDescription] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState(false)
  const [result, setResult] = useState<{ htmlUrl: string; id: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Scope-upgrade device-flow state. When the user clicks
  // "Authorize gist publishing" we run a second, narrowly-scoped
  // device flow asking GitHub for `repo gist`. The current device
  // code + verification URL live here so the modal can show them
  // until the user finishes authorising on github.com.
  const [scopeFlow, setScopeFlow] = useState<DeviceFlowStart | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  // AbortController for the in-flight scope-upgrade flow. Cancelled
  // when the modal closes or the user clicks Cancel; otherwise the
  // poll loop would keep running after the dialog disappears.
  const scopeAbortRef = useRef<AbortController | null>(null)

  // `null` scopes means "unknown" — older session without recorded
  // scopes. Treat as needing the upgrade; we'll either confirm the
  // gist scope from the upgrade flow or learn from a GistScopeError
  // that publish fails. Both paths funnel through the same UI.
  const needsScopeUpgrade = !hasGistScope(tokenScopes)

  // Reset state every time the modal re-opens for a fresh note.
  useEffect(() => {
    if (!isOpen) return
    setIsPublic(false)
    setDescription(note?.title ?? '')
    setError(null)
    setScopeError(false)
    setResult(null)
    setCopied(false)
    setScopeFlow(null)
    setAuthorizing(false)
  }, [isOpen, data?.noteId, note?.title])

  // Abort any in-flight scope-upgrade flow when the modal closes —
  // otherwise a backgrounded `pollForToken` would keep hitting the
  // proxy until the device code expires.
  useEffect(() => {
    if (isOpen) return
    scopeAbortRef.current?.abort()
    scopeAbortRef.current = null
  }, [isOpen])

  // Reset the "copied!" indicator after a short delay.
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  if (!isOpen) return null
  if (!note) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="Publish as gist" size="md">
        <div className="text-sm text-obsidianSecondaryText">Note not found.</div>
      </Modal>
    )
  }
  if (!token) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="Publish as gist" size="md">
        <div className="text-sm text-obsidianSecondaryText">
          Connect GitHub in Settings → GitHub sync first — gist publishing reuses your GitHub token.
        </div>
      </Modal>
    )
  }

  // Publish using an explicit token — separated out so the
  // post-upgrade auto-retry can pass the newly-issued token without
  // racing the Zustand state update.
  const runPublishWithToken = async (publishToken: string) => {
    setPublishing(true)
    setError(null)
    setScopeError(false)
    try {
      // Noteser tags are already inline in `note.content` (extracted on
      // the fly from `#word` patterns), so we don't re-stamp them —
      // uploading the raw body matches what readers see in the app and
      // avoids the double-tag-line bug from an earlier draft that
      // called `bodyWithInlineTags` (a pull-side helper).
      const content = note.content
      const r = await publishGist({
        token: publishToken,
        filename: sanitizeGistFilename(note.title || 'note'),
        content,
        description: description.trim(),
        isPublic,
      })
      setResult({ htmlUrl: r.htmlUrl, id: r.id })
    } catch (err) {
      if (err instanceof GistScopeError) {
        setScopeError(true)
        setError(err.message)
      } else {
        setError((err as Error).message)
      }
    } finally {
      setPublishing(false)
    }
  }

  const handlePublish = () => runPublishWithToken(token)

  // Drive a device flow that asks GitHub for the `repo gist` scope
  // specifically (not just at first sign-in). On success we update
  // the session with the new token + scopes and auto-retry publish.
  //
  // Why this exists: the default OAuth scope at sign-in is `repo` only,
  // so users who never publish a gist never grant gist read/write/delete.
  // This narrows the XSS blast radius of the localStorage token — see
  // security-audit Finding 2.
  const handleAuthorizeGistScope = async () => {
    // Cancel any prior in-flight scope flow so the user can re-click
    // "Authorize" without leaving orphaned polls behind.
    scopeAbortRef.current?.abort()
    const controller = new AbortController()
    scopeAbortRef.current = controller

    setAuthorizing(true)
    setError(null)
    setScopeError(false)
    setScopeFlow(null)
    try {
      const device = await startDeviceFlow('repo gist')
      if (controller.signal.aborted) return
      setScopeFlow(device)
      const newTokenSet = await pollForToken({
        deviceCode: device.device_code,
        interval: device.interval,
        expiresIn: device.expires_in,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const { user, scopes } = await fetchGitHubUserAndScopes(newTokenSet.accessToken)
      if (controller.signal.aborted) return
      // Persist the full token set so a gist-scope upgrade also captures the
      // refresh token (the upgraded token is the one we keep going forward).
      setSession(newTokenSet.accessToken, user, scopes, newTokenSet)
      setScopeFlow(null)
      // Auto-retry publish with the new token — the user's intent was
      // "publish my note", the scope prompt was incidental.
      if (hasGistScope(scopes)) {
        await runPublishWithToken(newTokenSet.accessToken)
      } else {
        // GitHub returned a token without the `gist` scope despite us
        // asking for it (rare — e.g. user manually deselected the scope
        // checkbox). Surface that explicitly so they know to retry.
        setError('GitHub did not grant the gist scope. Try authorising again and keep the gist checkbox ticked.')
      }
    } catch (err) {
      if (err instanceof DeviceFlowError && err.code === 'aborted') return
      setError(err instanceof Error ? err.message : 'Authorisation failed')
      setScopeFlow(null)
    } finally {
      if (!controller.signal.aborted) setAuthorizing(false)
    }
  }

  const handleCancelScopeFlow = () => {
    scopeAbortRef.current?.abort()
    scopeAbortRef.current = null
    setAuthorizing(false)
    setScopeFlow(null)
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.htmlUrl)
      setCopied(true)
    } catch {
      // clipboard write can reject for permission reasons; fall back
      // silently — the URL is still visible for manual copy.
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Publish as gist" size="md">
      {!result ? (
        <div className="space-y-4">
          <p className="text-sm text-obsidianSecondaryText">
            Publish <span className="text-obsidianText font-medium">{note.title || '(untitled)'}</span> as a GitHub gist.
            You&apos;ll get a shareable URL.
          </p>

          <div>
            <label className="block text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional — defaults to the note title"
              className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
              autoFocus
              data-testid="publish-gist-description"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1">
              Visibility
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${
                  !isPublic
                    ? 'bg-obsidianAccentPurple/15 border-obsidianAccentPurple text-obsidianText'
                    : 'bg-obsidianDarkGray border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText'
                }`}
                data-testid="publish-gist-secret"
              >
                <LockClosedIcon className="w-4 h-4" />
                <div className="text-left">
                  <div>Secret</div>
                  <div className="text-[10px] text-obsidianSecondaryText">URL-only access, not indexed</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${
                  isPublic
                    ? 'bg-obsidianAccentPurple/15 border-obsidianAccentPurple text-obsidianText'
                    : 'bg-obsidianDarkGray border-obsidianBorder text-obsidianSecondaryText hover:text-obsidianText'
                }`}
                data-testid="publish-gist-public"
              >
                <GlobeAltIcon className="w-4 h-4" />
                <div className="text-left">
                  <div>Public</div>
                  <div className="text-[10px] text-obsidianSecondaryText">Listed on your GitHub profile</div>
                </div>
              </button>
            </div>
          </div>

          {scopeFlow && (
            <div className="space-y-2 p-3 rounded bg-obsidianDarkGray border border-obsidianAccentPurple/40">
              <p className="text-xs text-obsidianSecondaryText">
                Enter this code on GitHub to grant the gist scope. The
                modal will retry publishing as soon as you authorise.
              </p>
              <code className="block text-center text-xl font-mono tracking-[0.25em] text-obsidianText select-all py-1">
                {scopeFlow.user_code}
              </code>
              <a
                href={scopeFlow.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-obsidianAccentPurple text-white rounded text-sm hover:bg-opacity-90 transition-colors no-underline"
                data-testid="publish-gist-scope-link"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                Open GitHub to authorise
              </a>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div>{error}</div>
                {scopeError && (
                  <div className="mt-1 text-obsidianSecondaryText">
                    Click &ldquo;Authorize gist publishing&rdquo; below to grant the gist scope — your existing access stays intact.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-obsidianBorder">
            {scopeFlow ? (
              <Button variant="ghost" onClick={handleCancelScopeFlow}>Cancel authorisation</Button>
            ) : (
              <Button variant="ghost" onClick={closeModal} disabled={publishing || authorizing}>Cancel</Button>
            )}
            {needsScopeUpgrade || scopeError ? (
              <Button
                variant="primary"
                onClick={handleAuthorizeGistScope}
                disabled={authorizing || publishing}
                data-testid="publish-gist-authorize"
              >
                {authorizing
                  ? (scopeFlow ? 'Waiting for GitHub…' : 'Requesting code…')
                  : 'Authorize gist publishing'}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handlePublish}
                disabled={publishing}
                data-testid="publish-gist-submit"
              >
                {publishing ? 'Publishing…' : 'Publish gist'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-testid="publish-gist-result">
          <div className="flex items-start gap-2 p-3 rounded bg-emerald-900/20 border border-emerald-900/40 text-sm text-emerald-200">
            <CheckIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Gist published</div>
              <div className="text-xs text-obsidianSecondaryText mt-0.5">
                {isPublic ? 'Public — listed on your GitHub profile.' : 'Secret — only viewable with the URL.'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-obsidianSecondaryText mb-1">
              Share URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={result.htmlUrl}
                className="flex-1 px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-xs text-obsidianText font-mono"
                onClick={e => (e.target as HTMLInputElement).select()}
                data-testid="publish-gist-url"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2 rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianSecondaryText hover:text-obsidianText hover:border-obsidianAccentPurple transition-colors"
                title="Copy URL to clipboard"
                data-testid="publish-gist-copy"
              >
                {copied ? <CheckIcon className="w-4 h-4 text-emerald-300" /> : <ClipboardDocumentIcon className="w-4 h-4" />}
              </button>
              <a
                href={result.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianSecondaryText hover:text-obsidianText hover:border-obsidianAccentPurple transition-colors"
                title="Open gist on GitHub"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="primary" onClick={closeModal}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default PublishGistModal
