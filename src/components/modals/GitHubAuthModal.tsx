'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useGitHubStore } from '@/stores'
import { startDeviceFlow, pollForToken, fetchGitHubUser, DeviceFlowError, type DeviceFlowStart } from '@/utils/github'

type Status =
  | { kind: 'requesting' }
  | { kind: 'waiting'; device: DeviceFlowStart }
  | { kind: 'success'; login: string }
  | { kind: 'error'; message: string }

export const GitHubAuthModal = () => {
  const { modal, closeModal } = useUIStore()
  const setSession = useGitHubStore((s) => s.setSession)

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
        const user = await fetchGitHubUser(token)
        if (controller.signal.aborted) return
        setSession(token, user)
        setStatus({ kind: 'success', login: user.login })
        // Brief success view, then auto-close.
        setTimeout(() => {
          if (!controller.signal.aborted) closeModal()
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
        const user = await fetchGitHubUser(token)
        setSession(token, user)
        setStatus({ kind: 'success', login: user.login })
        setTimeout(() => { if (!controller.signal.aborted) closeModal() }, 1200)
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setStatus({ kind: 'error', message })
      }
    })()
  }

  const copyAndOpen = async () => {
    if (status.kind !== 'waiting') return
    try {
      await navigator.clipboard.writeText(status.device.user_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable; still open GitHub so the user can paste manually.
    }
    window.open(status.device.verification_uri, '_blank', 'noopener,noreferrer')
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

          <button
            onClick={copyAndOpen}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-obsidianAccentPurple text-white rounded text-sm hover:bg-opacity-90 transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            {copied ? 'Code copied — Opening GitHub…' : 'Copy code & Open GitHub'}
          </button>

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
