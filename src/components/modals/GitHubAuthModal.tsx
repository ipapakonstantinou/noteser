'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useGitHubStore } from '@/stores'
import { startDeviceFlow, pollForToken, fetchGitHubUserAndScopes, DeviceFlowError, type DeviceFlowStart } from '@/utils/github'

type Status =
  | { kind: 'requesting' }
  | { kind: 'waiting'; device: DeviceFlowStart }
  | { kind: 'success'; login: string }
  | { kind: 'error'; message: string }

export const GitHubAuthModal = () => {
  const { modal, closeModal, openModal } = useUIStore()
  const setSession = useGitHubStore((s) => s.setSession)
  const syncRepo = useGitHubStore((s) => s.syncRepo)

  const isOpen = modal.type === 'github-auth'
  const [status, setStatus] = useState<Status>({ kind: 'requesting' })
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Run the device flow whenever the modal opens; cancel on close.
  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'requesting' })
    setCopied(false)
    ;(async () => {
      try {
        const device = await startDeviceFlow()
        if (controller.signal.aborted) return
        setStatus({ kind: 'waiting', device })
        const token = await pollForToken({
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
        const { user, scopes } = await fetchGitHubUserAndScopes(token)
        if (controller.signal.aborted) return
        setSession(token, user, scopes)
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
        const token = await pollForToken({
          deviceCode: device.device_code,
          interval: device.interval,
          expiresIn: device.expires_in,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const { user, scopes } = await fetchGitHubUserAndScopes(token)
        setSession(token, user, scopes)
        setStatus({ kind: 'success', login: user.login })
        setTimeout(() => { if (!controller.signal.aborted) closeModal() }, 1200)
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setStatus({ kind: 'error', message })
      }
    })()
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

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Connect to GitHub" size="md">
      {status.kind === 'requesting' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="animate-spin h-8 w-8 border-2 border-obsidianAccentPurple border-t-transparent rounded-full" />
          <p className="text-sm text-obsidianSecondaryText">Requesting a device code from GitHub…</p>
        </div>
      )}

      {status.kind === 'waiting' && (
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
        </div>
      )}

      {status.kind === 'success' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircleIcon className="w-10 h-10 text-green-500" />
          <p className="text-sm text-obsidianText">Connected as <strong>@{status.login}</strong></p>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/40 rounded">
            <ExclamationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{status.message}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button variant="primary" onClick={handleRetry}>Try again</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default GitHubAuthModal
