'use client'

import { Modal, Button } from '@/components/ui'

interface ResetConfirmModalProps {
  isOpen: boolean
  /** True when the user has notes that haven't been pushed to GitHub yet. */
  hasUnsynced: boolean
  /** True when a GitHub repo is connected (so we can hint at the
   *  preserved-creds + re-pull flow). */
  hasRepo: boolean
  onPartialWipe: () => void
  onFullWipe: () => void
  onCancel: () => void
}

// Shown when the PERSISTED_RESET_VERSION kill-switch decides a wipe is
// needed AND there are unsynced changes (otherwise we wipe silently).
// In-app modal — NOT window.confirm — because confirm dialogs get
// hidden behind tabs and the UI looks frozen.
export function ResetConfirmModal({
  isOpen,
  hasUnsynced,
  hasRepo,
  onPartialWipe,
  onFullWipe,
  onCancel,
}: ResetConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Noteser needs a cleanup" size="lg">
      <div className="space-y-4 text-sm text-obsidianText" data-testid="reset-confirm-modal">
        <p>
          A new release needs to clear some local cache to recover from a
          state drift that was affecting sync.
        </p>

        {hasUnsynced && (
          <div className="rounded-sm border border-yellow-700/40 bg-yellow-900/10 p-3 text-yellow-200">
            <strong>Heads up:</strong> you have local notes that haven&apos;t
            been pushed to GitHub yet. Sync them first (Sidebar → GitHub →
            Sync) if you want them preserved.
          </div>
        )}

        <div className="space-y-2">
          <p className="font-medium text-obsidianText">Recommended: partial cleanup</p>
          <ul className="text-xs text-obsidianSecondaryText pl-4 list-disc space-y-1">
            <li>Wipes: notes, folders, open tabs (re-pulled from GitHub next sync)</li>
            <li>
              Keeps: GitHub connection {hasRepo ? '(no re-login needed)' : '(not connected)'},
              user settings, sidebar layout, locally-stored attachments
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-obsidianText">Full reset (escape hatch)</p>
          <ul className="text-xs text-obsidianSecondaryText pl-4 list-disc space-y-1">
            <li>Wipes everything noteser-related. You&apos;ll need to reconnect GitHub.</li>
            <li>Same as visiting <code>?reset=1</code>.</li>
          </ul>
        </div>

        <div className="flex justify-between items-center pt-2 gap-2 flex-wrap">
          <Button variant="secondary" onClick={onCancel}>
            Not now
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onFullWipe}>
              Full reset
            </Button>
            <Button variant="primary" onClick={onPartialWipe} data-testid="reset-partial">
              Partial cleanup
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ResetConfirmModal
