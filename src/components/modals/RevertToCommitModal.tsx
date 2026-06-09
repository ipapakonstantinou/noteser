'use client'

import { useEffect, useState } from 'react'
import {
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useGitHubStore } from '@/stores'
import { useGitHubSync } from '@/hooks/useGitHubSync'
import { revertToCommit, type RevertToCommitResult } from '@/utils/revertToCommit'
import { ReconnectRequiredError } from '@/utils/tokenRefresh'

// Revert-to-commit modal — fired from a row in Source Control →
// Recent commits. Two-step UX:
//   1. Confirm: explain what's about to happen ("this will replace
//      your local notes with the state at commit X; unpushed local
//      notes will be preserved; then we'll auto-push").
//   2. Result: show the diff summary and offer to run the sync now.
//
// Opens via useUIStore.openModal({
//   type: 'revert-to-commit',
//   data: { commitSha, shortSha, message }
// })
//
// Bundles the auto-push because the user's stated intent
// ("revert to previous commit AND push") is the whole workflow.

interface RevertModalData {
  commitSha: string
  shortSha: string
  message: string
}

export const RevertToCommitModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const data = modal.data as RevertModalData | undefined
  const isOpen = modal.type === 'revert-to-commit'

  const token = useGitHubStore(s => s.token)
  const repo = useGitHubStore(s => s.syncRepo)
  const { runSync } = useGitHubSync()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RevertToCommitResult | null>(null)
  const [pushedOk, setPushedOk] = useState(false)
  // Fetch progress so the button stops looking hung on a large vault.
  // null until the first blob progress callback fires.
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setBusy(false)
    setError(null)
    setResult(null)
    setPushedOk(false)
    setProgress(null)
  }, [isOpen, data?.commitSha])

  if (!isOpen || !data) return null
  if (!token || !repo) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="Revert vault" size="md">
        <div className="text-sm text-obsidianSecondaryText">
          Connect a GitHub repo in Settings → GitHub sync first.
        </div>
      </Modal>
    )
  }

  const handleRevert = async () => {
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const out = await revertToCommit({
        token,
        owner: repo.owner,
        repo: repo.name,
        commitSha: data.commitSha,
        onBlobProgress: (fetched, total) => setProgress({ fetched, total }),
      })
      setResult(out)
    } catch (err) {
      // A token that couldn't be renewed surfaces as ReconnectRequiredError —
      // show its message verbatim so the user knows to reconnect rather than
      // retry into the same 401.
      if (err instanceof ReconnectRequiredError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Revert failed')
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const handlePush = async () => {
    setBusy(true)
    setError(null)
    try {
      const subject = data.message.split('\n')[0]?.slice(0, 60) ?? data.shortSha
      await runSync(`Revert vault to ${data.shortSha} — ${subject}`)
      setPushedOk(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Revert vault" size="md">
      {!result ? (
        // ── Step 1: confirm ───────────────────────────────────────────────
        <div className="space-y-4 text-sm">
          <p className="text-obsidianSecondaryText">
            This will replace your local notes with the state at commit{' '}
            <code className="text-obsidianAccentPurple font-mono">{data.shortSha}</code>:
          </p>
          <blockquote className="px-3 py-2 border-l-2 border-obsidianAccentPurple/50 text-xs text-obsidianText bg-obsidianDarkGray/40 rounded-r">
            {data.message || '(no commit message)'}
          </blockquote>
          <div className="flex items-start gap-2 p-3 rounded bg-amber-900/20 border border-amber-900/40 text-amber-200">
            <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1 text-amber-200/90">
              <div>
                Pushed notes get their content rewritten to match the
                historical version. Notes that exist locally but not at
                this commit are soft-deleted (recoverable from Trash).
              </div>
              <div>
                Unpushed local notes (no <code>gitPath</code>) are preserved.
              </div>
              <div>
                You&apos;ll be prompted to push the result as a new commit on top —
                the GitHub history is preserved, not rewritten.
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={closeModal} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleRevert}
              disabled={busy}
              data-testid="revert-confirm"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
              {busy
                ? progress && progress.total > 0
                  ? `Fetching ${progress.fetched}/${progress.total}…`
                  : 'Rewinding…'
                : 'Revert vault'}
            </Button>
          </div>
        </div>
      ) : (
        // ── Step 2: show diff summary + push ──────────────────────────────
        <div className="space-y-4 text-sm">
          {!pushedOk ? (
            <div className="flex items-start gap-2 p-3 rounded bg-emerald-900/20 border border-emerald-900/40 text-emerald-200">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-medium">Local state rewound to {data.shortSha}.</div>
                <div className="text-obsidianSecondaryText">Push now to make GitHub match — it&apos;ll land as a new commit on top of the current branch.</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 rounded bg-emerald-900/20 border border-emerald-900/40 text-emerald-200">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-medium">Pushed. Vault and remote both at {data.shortSha}.</div>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs" data-testid="revert-summary">
            <SummaryRow label="Rewritten" value={result.replaced} />
            <SummaryRow label="Restored from history" value={result.created} />
            <SummaryRow label="Soft-deleted" value={result.removed} />
            <SummaryRow label="Unpushed (preserved)" value={result.preservedUnpushed} />
          </dl>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            {pushedOk ? (
              <Button variant="primary" onClick={closeModal}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={closeModal} disabled={busy}>Skip push (push manually later)</Button>
                <Button
                  variant="primary"
                  onClick={handlePush}
                  disabled={busy}
                  data-testid="revert-push"
                >
                  {busy ? 'Pushing…' : 'Push revert commit'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

const SummaryRow = ({ label, value }: { label: string; value: number }) => (
  <>
    <dt className="text-obsidianSecondaryText">{label}</dt>
    <dd className="text-obsidianText font-mono">{value}</dd>
  </>
)

export default RevertToCommitModal
