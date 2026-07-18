'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui'
import { useWorkspaceStore } from '@/stores'
import { applyConflictResolution, applyMergedConflict } from '@/utils/syncApply'
import { diffByLine, composeMerged, type DiffHunk } from '@/utils/lineDiff'
import type { ConflictTabData } from '@/stores/workspaceStore'

type HunkChoice = 'local' | 'remote' | 'both' | 'skip'

interface Props {
  tabId: string
  conflict: ConflictTabData
}

export const MergeEditorView = ({ tabId, conflict }: Props) => {
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const recordMergeApplied = useWorkspaceStore(s => s.recordMergeApplied)

  const [choices, setChoices] = useState<Record<number, HunkChoice>>({})
  const [deletedChoice, setDeletedChoice] = useState<'local' | 'remote' | null>(null)

  // Reset whenever the conflict changes (new sync, fresh tab).
  useEffect(() => {
    setChoices({})
    setDeletedChoice(null)
  }, [conflict])

  const hunks: DiffHunk[] = useMemo(() => {
    if (conflict.kind !== 'conflict') return []
    return diffByLine(conflict.localContent, conflict.remoteContent)
  }, [conflict])
  const changeHunkIndices = useMemo(
    () => hunks.flatMap((h, i) => h.type === 'change' ? [i] : []),
    [hunks],
  )

  const resolved = conflict.kind === 'conflictDeleted'
    ? deletedChoice != null
    : changeHunkIndices.every(i => choices[i] != null)

  const setHunkChoice = (hunkIdx: number, choice: HunkChoice | null) => {
    setChoices(prev => {
      const next = { ...prev }
      if (choice == null) delete next[hunkIdx]
      else next[hunkIdx] = choice
      return next
    })
  }

  const applyAndClose = () => {
    if (conflict.kind === 'conflictDeleted') {
      if (deletedChoice) {
        applyConflictResolution(conflict, deletedChoice)
        recordMergeApplied()
      }
    } else {
      const merged = composeMerged(hunks, choices)
      applyMergedConflict(conflict, merged)
      recordMergeApplied()
    }
    // The workspace store will fire sync-request when this is the last merge tab.
    closeTab(tabId)
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-obsidianBlack">
      {/* Header */}
      <div className="px-4 py-2 border-b border-obsidianBorder space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded-sm text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            Use the action links above each conflict region to pick a side. Resolved regions
            collapse; hover them to revert.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm text-obsidianText truncate">{conflict.path}</code>
              {resolved && <CheckCircleIcon className="w-4 h-4 text-green-500 shrink-0" />}
            </div>
            <div className="text-xs text-obsidianSecondaryText">
              {conflict.kind === 'conflict'
                ? <>Merge conflict · {changeHunkIndices.length} region{changeHunkIndices.length === 1 ? '' : 's'}</>
                : <>Remote deleted · local has unsynced edits</>}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-obsidianBorder">
            <Button variant="ghost" onClick={() => closeTab(tabId)}>Cancel</Button>
            <Button variant="primary" onClick={applyAndClose} disabled={!resolved}>
              Apply
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {conflict.kind === 'conflictDeleted' ? (
          <DeletedConflictView
            localContent={conflict.localContent}
            choice={deletedChoice}
            onChoose={setDeletedChoice}
          />
        ) : (
          <MergeView
            hunks={hunks}
            choices={choices}
            onChooseHunk={setHunkChoice}
          />
        )}
      </div>
    </div>
  )
}

// ── Inline merge view (VS Code conflict-marker style) ───────────────────────

type RowKind = 'context' | 'marker' | 'local' | 'remote' | 'actions' | 'resolved'

interface DisplayRow {
  kind: RowKind
  text?: string
  hunkIdx?: number
  side?: 'local' | 'remote'
  choice?: HunkChoice
}

function buildRows(hunks: DiffHunk[], choices: Record<number, HunkChoice>): DisplayRow[] {
  const rows: DisplayRow[] = []
  hunks.forEach((h, i) => {
    if (h.type === 'equal') {
      for (const line of h.lines) rows.push({ kind: 'context', text: line })
      return
    }
    const choice = choices[i]
    if (choice == null) {
      rows.push({ kind: 'actions', hunkIdx: i })
      rows.push({ kind: 'marker', side: 'local', text: '<<<<<<< Local', hunkIdx: i })
      for (const line of h.localLines) rows.push({ kind: 'local', text: line, hunkIdx: i })
      rows.push({ kind: 'marker', text: '=======', hunkIdx: i })
      for (const line of h.remoteLines) rows.push({ kind: 'remote', text: line, hunkIdx: i })
      rows.push({ kind: 'marker', side: 'remote', text: '>>>>>>> Remote', hunkIdx: i })
      return
    }
    const wantLocal  = choice === 'local'  || choice === 'both'
    const wantRemote = choice === 'remote' || choice === 'both'
    let first = true
    const push = (text: string, side: 'local' | 'remote' | undefined) => {
      rows.push({ kind: 'resolved', text, hunkIdx: first ? i : undefined, choice, side })
      first = false
    }
    if (wantLocal) {
      if (h.localLines.length === 0) push('', 'local')
      else for (const line of h.localLines) push(line, 'local')
    }
    if (wantRemote) {
      if (h.remoteLines.length === 0) push('', 'remote')
      else for (const line of h.remoteLines) push(line, 'remote')
    }
    if (choice === 'skip') push('', undefined)
  })
  return rows
}

const MergeView = ({
  hunks,
  choices,
  onChooseHunk,
}: {
  hunks: DiffHunk[]
  choices: Record<number, HunkChoice>
  onChooseHunk: (hunkIdx: number, choice: HunkChoice | null) => void
}) => {
  const rows = useMemo(() => buildRows(hunks, choices), [hunks, choices])
  let lineNo = 0
  return (
    <div className="font-mono text-xs border border-obsidianBorder rounded-sm overflow-hidden">
      {rows.map((row, idx) => {
        if (row.kind === 'actions' && row.hunkIdx != null) {
          const i = row.hunkIdx
          return (
            <div
              key={idx}
              className="flex items-center gap-3 px-3 py-1 text-[11px] bg-obsidianDarkGray border-t border-b border-obsidianBorder"
            >
              <ActionLink onClick={() => onChooseHunk(i, 'local')}>Accept Local</ActionLink>
              <span className="text-obsidianSecondaryText">|</span>
              <ActionLink onClick={() => onChooseHunk(i, 'remote')}>Accept Remote</ActionLink>
              <span className="text-obsidianSecondaryText">|</span>
              <ActionLink onClick={() => onChooseHunk(i, 'both')}>Accept Both</ActionLink>
              <span className="text-obsidianSecondaryText">|</span>
              <ActionLink onClick={() => onChooseHunk(i, 'skip')}>Skip</ActionLink>
            </div>
          )
        }
        lineNo++
        const isMarker   = row.kind === 'marker'
        const isResolved = row.kind === 'resolved'
        const isLocal    = row.kind === 'local'  || (isResolved && row.side === 'local')
        const isRemote   = row.kind === 'remote' || (isResolved && row.side === 'remote')
        const bg =
          isMarker && row.side === 'local'  ? 'bg-red-950/40 text-red-200' :
          isMarker && row.side === 'remote' ? 'bg-green-950/40 text-green-200' :
          isMarker                          ? 'bg-obsidianHighlight text-obsidianSecondaryText' :
          isResolved && isLocal             ? 'bg-red-950/15' :
          isResolved && isRemote            ? 'bg-green-950/15' :
          isResolved                        ? 'bg-obsidianHighlight/40' :
          isLocal                           ? 'bg-red-950/25' :
          isRemote                          ? 'bg-green-950/25' :
          ''
        return (
          <div key={idx} className={`flex group ${bg}`}>
            <div className="select-none w-10 text-right pr-2 py-0.5 text-obsidianSecondaryText/60 shrink-0">
              {lineNo}
            </div>
            <pre className="flex-1 py-0.5 px-2 text-obsidianText whitespace-pre-wrap wrap-break-word min-w-0">
              {row.text ?? ''}
            </pre>
            {isResolved && row.hunkIdx != null && (
              <button
                onClick={() => onChooseHunk(row.hunkIdx!, null)}
                className="opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-wide text-obsidianSecondaryText hover:text-obsidianText px-2 py-0.5 self-center transition-opacity"
                title="Revert choice"
              >
                {row.choice} ↻
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

const ActionLink = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className="text-obsidianAccentPurple hover:underline focus:outline-hidden">
    {children}
  </button>
)

const DeletedConflictView = ({
  localContent, choice, onChoose,
}: {
  localContent: string
  choice: 'local' | 'remote' | null
  onChoose: (c: 'local' | 'remote') => void
}) => (
  <div className="space-y-3 max-w-3xl">
    <div className="px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded-sm text-sm text-amber-200">
      The remote file was deleted, but you have unsynced local edits. Keep your local copy (it
      will be re-created on next sync) or accept the deletion (the note will be moved to trash).
    </div>
    <div>
      <div className="text-xs text-obsidianSecondaryText mb-1 font-mono">Local content</div>
      <pre className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded-sm p-2 whitespace-pre-wrap max-h-72 overflow-auto font-mono">
        {localContent}
      </pre>
    </div>
    <div className="flex gap-2">
      <button
        onClick={() => onChoose('local')}
        className={`flex-1 px-3 py-2 rounded text-sm ${
          choice === 'local' ? 'bg-obsidianAccentPurple text-white' : 'bg-obsidianDarkGray text-obsidianText hover:bg-obsidianHighlight'
        }`}
      >
        Keep local
      </button>
      <button
        onClick={() => onChoose('remote')}
        className={`flex-1 px-3 py-2 rounded text-sm ${
          choice === 'remote' ? 'bg-obsidianAccentPurple text-white' : 'bg-obsidianDarkGray text-obsidianText hover:bg-obsidianHighlight'
        }`}
      >
        Accept delete
      </button>
    </div>
  </div>
)

export default MergeEditorView
