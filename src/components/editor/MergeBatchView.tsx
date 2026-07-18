'use client'

import { useMemo, useState } from 'react'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui'
import { useWorkspaceStore } from '@/stores'
import { applyConflictResolution, applyMergedConflict } from '@/utils/syncApply'
import { diffByLine, composeMerged } from '@/utils/lineDiff'
import type { ConflictTabData } from '@/stores/workspaceStore'

// Summary view for a batch of conflicts after a pull surfaces drift across
// many files. Lets the user resolve each conflict with a single click
// ("use mine" / "use theirs"), batch-resolve everything at once, or drill
// into the per-conflict merge editor when a file needs line-level care.
//
// Keeps the workspace tidy: ONE tab covers N conflicts instead of N tabs.

type Resolution = 'local' | 'remote' | 'pending'

interface Props {
  tabId: string
  conflicts: ConflictTabData[]
}

export const MergeBatchView = ({ tabId, conflicts }: Props) => {
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const recordMergeApplied = useWorkspaceStore(s => s.recordMergeApplied)
  const openMergeConflicts = useWorkspaceStore(s => s.openMergeConflicts)
  const [decisions, setDecisions] = useState<Record<string, Resolution>>({})
  const [confirmingBulk, setConfirmingBulk] = useState<'local' | 'remote' | null>(null)

  const conflictKey = (c: ConflictTabData) =>
    c.kind === 'conflict' ? `c:${c.noteId}` : `cd:${c.noteId}`

  const summary = useMemo(() => {
    const pending = conflicts.filter(c => (decisions[conflictKey(c)] ?? 'pending') === 'pending')
    return {
      total: conflicts.length,
      resolved: conflicts.length - pending.length,
      pending: pending.length,
    }
  }, [conflicts, decisions])

  const resolveOne = (c: ConflictTabData, choice: 'local' | 'remote') => {
    applyConflictResolution(c, choice)
    recordMergeApplied()
    setDecisions(prev => ({ ...prev, [conflictKey(c)]: choice }))
  }

  const resolveAll = (choice: 'local' | 'remote') => {
    for (const c of conflicts) {
      if ((decisions[conflictKey(c)] ?? 'pending') !== 'pending') continue
      applyConflictResolution(c, choice)
      recordMergeApplied()
    }
    const next: Record<string, Resolution> = {}
    for (const c of conflicts) {
      next[conflictKey(c)] = decisions[conflictKey(c)] ?? choice
    }
    setDecisions(next)
    setConfirmingBulk(null)
  }

  const drillDown = (c: ConflictTabData) => {
    // Spawn a per-conflict merge-conflict tab. Closing it after Apply
    // will fire its own recordMergeApplied; we treat the row as
    // resolved heuristically when the user comes back.
    openMergeConflicts([c])
  }

  // 3-way auto-merge inside the batch view — line-level merge composed
  // with all hunks set to "both" so non-overlapping edits resolve as
  // their union. Only available on `conflict` kind (not conflictDeleted).
  const autoMergeOne = (c: ConflictTabData) => {
    if (c.kind !== 'conflict') return
    const hunks = diffByLine(c.localContent, c.remoteContent)
    const choices: Record<number, 'local' | 'remote' | 'both' | 'skip'> = {}
    for (let i = 0; i < hunks.length; i++) {
      if (hunks[i].type === 'change') choices[i] = 'both'
    }
    const merged = composeMerged(hunks, choices)
    applyMergedConflict(c, merged)
    recordMergeApplied()
    setDecisions(prev => ({ ...prev, [conflictKey(c)]: 'local' }))
  }

  const closeWhenDone = () => closeTab(tabId)

  const allResolved = summary.pending === 0
  const headerCopy = allResolved
    ? `All ${summary.total} conflict${summary.total === 1 ? '' : 's'} resolved`
    : `${summary.pending} of ${summary.total} conflict${summary.total === 1 ? '' : 's'} pending`

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-obsidianBlack">
      <div className="px-4 py-2 border-b border-obsidianBorder space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded-sm text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            A pull brought back changes that conflict with your local edits. Pick a side per file, drill in for a line-by-line merge, or resolve them all at once.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-obsidianText font-medium">{headerCopy}</div>
            <div className="text-xs text-obsidianSecondaryText">{conflicts.length} file{conflicts.length === 1 ? '' : 's'} drifted since your last sync</div>
          </div>
          <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-obsidianBorder">
            {!allResolved && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmingBulk('local')}
                  data-testid="merge-batch-keep-all-mine"
                >
                  Keep all mine
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmingBulk('remote')}
                  data-testid="merge-batch-take-all-theirs"
                >
                  Take all theirs
                </Button>
              </>
            )}
            <Button variant={allResolved ? 'primary' : 'ghost'} onClick={closeWhenDone}>
              {allResolved ? 'Done — close & sync' : 'Cancel'}
            </Button>
          </div>
        </div>
      </div>

      {confirmingBulk && (
        <div className="px-4 py-3 border-b border-obsidianBorder bg-obsidianGray/60">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-400" />
            <div className="flex-1 text-sm text-obsidianText">
              {confirmingBulk === 'local'
                ? `Discard remote changes in ${summary.pending} file${summary.pending === 1 ? '' : 's'} and keep your local version everywhere?`
                : `Discard your local edits in ${summary.pending} file${summary.pending === 1 ? '' : 's'} and accept the remote version everywhere?`}
            </div>
            <Button variant="ghost" onClick={() => setConfirmingBulk(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => resolveAll(confirmingBulk)} data-testid="merge-batch-confirm-bulk">
              Apply to all
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-obsidianBorder">
          {conflicts.map((c) => {
            const key = conflictKey(c)
            const decision = decisions[key] ?? 'pending'
            const resolved = decision !== 'pending'
            return (
              <li key={key} className={`px-4 py-3 flex items-center gap-3 ${resolved ? 'opacity-60' : ''}`} data-testid="merge-batch-row">
                <DocumentTextIcon className="w-5 h-5 shrink-0 text-obsidianSecondaryText" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-obsidianText truncate" title={c.path}>{c.path}</div>
                  <div className="text-xs text-obsidianSecondaryText">
                    {c.kind === 'conflict' ? 'Both sides changed' : 'Remote deleted; local has unsynced edits'}
                    {resolved && <> · resolved → {decision === 'local' ? 'kept mine' : 'took theirs'}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {resolved ? (
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => resolveOne(c, 'local')}
                        title="Keep my local version, discard remote"
                        data-testid="merge-batch-keep-mine"
                      >
                        <ArrowLeftIcon className="w-4 h-4" /> Mine
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => resolveOne(c, 'remote')}
                        title="Take the remote version, discard local"
                        data-testid="merge-batch-take-theirs"
                      >
                        Theirs <ArrowRightIcon className="w-4 h-4" />
                      </Button>
                      {c.kind === 'conflict' && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => autoMergeOne(c)}
                            title="3-way merge (union of non-overlapping edits)"
                            data-testid="merge-batch-automerge"
                          >
                            <ArrowsRightLeftIcon className="w-4 h-4" /> Merge
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => drillDown(c)}
                            title="Open the line-by-line merge editor"
                            data-testid="merge-batch-open-editor"
                          >
                            Open editor
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default MergeBatchView
