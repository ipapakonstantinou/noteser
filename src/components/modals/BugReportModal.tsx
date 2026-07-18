'use client'

import { useState } from 'react'
import { useUIStore, useGitHubStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import {
  buildIssueBody,
  createGitHubIssue,
  DEFAULT_TARGET_REPO,
  type BugReportForm,
} from '@/utils/bugReport'
import { withTokenRefresh } from '@/utils/tokenRefresh'

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'ok'; url: string }
  | { kind: 'err'; message: string; body: string }

export const BugReportModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const token = useGitHubStore(s => s.token)
  const isOpen = modal.type === 'bug-report'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (!isOpen) return null

  const form: BugReportForm = {
    title, description, steps, includeDiagnostics,
    targetRepo: DEFAULT_TARGET_REPO,
  }
  const previewBody = buildIssueBody(form)

  const handleSubmit = async () => {
    if (!token) {
      setStatus({
        kind: 'err',
        message: 'Connect to GitHub first (Settings → GitHub sync) to file an issue. Use Copy to clipboard as a fallback.',
        body: previewBody,
      })
      return
    }
    setStatus({ kind: 'submitting' })
    try {
      // withTokenRefresh: an expired OAuth token auto-renews instead of the
      // submit dying on a 401 (same orchestration as the sync pull/push).
      const { url } = await withTokenRefresh(tok => createGitHubIssue(form, tok))
      setStatus({ kind: 'ok', url })
    } catch (err) {
      setStatus({
        kind: 'err',
        message: err instanceof Error ? err.message : 'Submit failed',
        body: previewBody,
      })
    }
  }

  const handleCopyToClipboard = async () => {
    const text = `# ${title || 'Bug report'}\n\n${previewBody}`
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind: 'err', message: 'Copied to clipboard. Paste it into a new GitHub issue manually.', body: previewBody })
    } catch {
      // Clipboard API blocked — drop the text into a textarea so user can copy.
      window.prompt('Copy the report from this box:', text)
    }
  }

  const reset = () => {
    setTitle(''); setDescription(''); setSteps(''); setShowPreview(false)
    setStatus({ kind: 'idle' })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { reset(); closeModal() }}
      title="Report a bug"
      size="lg"
    >
      {status.kind === 'ok' ? (
        <div className="space-y-3">
          <p className="text-sm text-obsidianText">
            Issue filed successfully. Thanks!
          </p>
          <a
            href={status.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline text-sm break-all"
          >
            {status.url}
          </a>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => { reset(); closeModal() }}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <FormRow label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the bug"
              className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:ring-2 focus:ring-obsidianAccentPurple focus:border-transparent"
              autoFocus
            />
          </FormRow>
          <FormRow label="What happened">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe the bug…"
              className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:ring-2 focus:ring-obsidianAccentPurple focus:border-transparent"
            />
          </FormRow>
          <FormRow label="Steps to reproduce">
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={3}
              placeholder="1. … 2. … 3. … (optional)"
              className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:ring-2 focus:ring-obsidianAccentPurple focus:border-transparent"
            />
          </FormRow>

          <label className="flex items-center gap-2 text-sm text-obsidianText cursor-pointer">
            <input
              type="checkbox"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
            />
            <span>
              Attach diagnostics (sanitised — no tokens or API keys)
            </span>
          </label>

          <button
            type="button"
            onClick={() => setShowPreview(v => !v)}
            className="text-xs text-obsidianAccentPurple hover:underline"
          >
            {showPreview ? 'Hide preview' : 'Preview report body'}
          </button>
          {showPreview && (
            <pre className="text-xs bg-obsidianDarkGray border border-obsidianBorder rounded-sm p-3 overflow-auto max-h-64 whitespace-pre-wrap text-obsidianSecondaryText">
              {previewBody}
            </pre>
          )}

          {status.kind === 'err' && (
            <div className="text-sm text-red-400 border border-red-500/40 bg-red-500/5 rounded-sm p-2">
              {status.message}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="secondary" onClick={handleCopyToClipboard}>
              Copy to clipboard
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { reset(); closeModal() }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={status.kind === 'submitting' || !title.trim() || !description.trim()}
              >
                {status.kind === 'submitting' ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const FormRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <div className="text-sm font-medium text-obsidianText">{label}</div>
    {children}
  </div>
)

export default BugReportModal
