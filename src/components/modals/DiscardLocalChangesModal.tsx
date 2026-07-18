'use client'

import { useState } from 'react'
import { ExclamationTriangleIcon, ArrowUturnLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useNoteStore } from '@/stores'
import { useGitHubSync } from '@/hooks/useGitHubSync'
import { resetToRemote } from '@/utils/resetToRemote'

// Quick "discard everything I've edited locally" surface.
//
// Opens from the Source Control toolbar's trash icon. Re-uses the
// existing `resetToRemote` util — same code path Settings → GitHub
// sync → Reset to remote runs. The difference is just discoverability:
// users in the middle of an edit-and-regret loop look at the SCM
// panel, not Settings.
//
// Two-step UX: show the unpushed-count warning + a "Also drop unpushed
// local notes" toggle (off by default — same default as the Settings
// surface) → confirm → wipe + auto-pull.

export const DiscardLocalChangesModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const isOpen = modal.type === 'discard-local-changes'
  // Discard is a RESET-TO-REMOTE: we want to PULL the remote version, never
  // push. Using runSync here re-pushed settings.json + attachments after the
  // wipe (a surprise commit). runPullOnly only fetches + applies.
  const { runPullOnly } = useGitHubSync()

  // Count notes that exist locally without a gitPath — these are
  // the unpushed ones the "Also drop" toggle would wipe. Used in
  // the warning copy so the user knows what they'd lose.
  const notes = useNoteStore(s => s.notes)
  const unsyncedCount = notes.filter(n => !n.isDeleted && !n.gitPath).length

  const [alsoDropUnpushed, setAlsoDropUnpushed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await resetToRemote({ preserveUnpushed: !alsoDropUnpushed })
      // Pull-only: repopulate the wiped notes from remote. We must NOT push
      // here — discard resets us TO the remote, so there is nothing to send.
      // (runSync pushed settings.json + attachments after the wipe, which
      // surprised the user with an unasked-for commit.)
      await runPullOnly()
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Discard local changes" size="md">
      {!done ? (
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 p-3 rounded-sm bg-red-900/20 border border-red-900/40 text-red-200">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-red-200/90">
              <div className="font-medium text-red-200">This is destructive.</div>
              <div>
                Drops every local edit to a pushed note. The next sync
                re-pulls the remote version — so anything you&apos;d
                changed locally since the last successful push is lost.
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={alsoDropUnpushed}
              onChange={e => setAlsoDropUnpushed(e.target.checked)}
              className="mt-0.5 accent-obsidianAccentPurple"
              data-testid="discard-also-drop-unpushed"
            />
            <div className="text-xs">
              <div className="text-obsidianText">Also drop unpushed local notes</div>
              <div className="text-obsidianSecondaryText">
                By default, notes you&apos;ve never pushed are preserved (they only exist on this device).
                Tick to wipe those too for a fully clean slate.
                {unsyncedCount > 0 && (
                  <span className="text-amber-300"> {unsyncedCount} unpushed note(s) would be dropped.</span>
                )}
              </div>
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-sm bg-red-900/20 border border-red-900/40 text-xs text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={closeModal} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={busy}
              data-testid="discard-confirm"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
              {busy ? 'Discarding…' : 'Discard + sync'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 p-3 rounded-sm bg-emerald-900/20 border border-emerald-900/40 text-emerald-200 text-xs">
            <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <span>Local changes discarded. The vault now matches what&apos;s on the remote.</span>
          </div>
          <div className="flex justify-end pt-2 border-t border-obsidianBorder">
            <Button variant="primary" onClick={closeModal}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default DiscardLocalChangesModal
