'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui'
import { useWorkspaceStore } from '@/stores'
import { applyConflictResolution, applyMergedConflict } from '@/utils/syncApply'
import { diffByLine, composeMerged, type DiffHunk } from '@/utils/lineDiff'
import type { ConflictTabData } from '@/stores/workspaceStore'

// Module-level signal so the sidebar's sync hook can pick up where we left
// off after Apply. Same convention as the old conflict modal.
export const SYNC_REQUEST_EVENT = 'noteser:sync-request'

type HunkChoice = 'local' | 'remote' | 'both' | 'skip'
type ChoiceMap = Record<string, Record<number, HunkChoice>>

interface Props {
  tabId: string
  conflicts: ConflictTabData[]
}

export const MergeEditorView = ({ tabId, conflicts }: Props) => {
  const closeTab = useWorkspaceStore(s => s.closeTab)

  const [currentIdx, setCurrentIdx] = useState(0)
  const [choices, setChoices] = useState<ChoiceMap>({})
  const [deletedChoice, setDeletedChoice] = useState<Record<string, 'local' | 'remote'>>({})

  // Reset when a new conflict batch arrives.
  useEffect(() => {
    setCurrentIdx(0)
    setChoices({})
    setDeletedChoice({})
  }, [conflicts])

  const current = conflicts[currentIdx]
  const hunks: DiffHunk[] = useMemo(() => {
    if (!current || current.kind !== 'conflict') return []
    return diffByLine(current.localContent, current.remoteContent)
  }, [current])
  const changeHunkIndices = useMemo(
    () => hunks.flatMap((h, i) => h.type === 'change' ? [i] : []),
    [hunks],
  )

  const currentChoices = current ? (choices[current.path] ?? {}) : {}
  const currentResolved = current && (
    current.kind === 'conflictDeleted'
      ? !!deletedChoice[current.path]
      : changeHunkIndices.every(i => currentChoices[i] != null)
  )

  const totalResolved = conflicts.filter(c =>
    c.kind === 'conflictDeleted'
      ? !!deletedChoice[c.path]
      : (() => {
          const cs = choices[c.path] ?? {}
          const h = diffByLine(c.localContent, c.remoteContent)
          return h.every((hh, i) => hh.type === 'equal' || cs[i] != null)
        })(),
  ).length
  const allResolved = totalResolved === conflicts.length && conflicts.length > 0

  const setHunkChoice = (path: string, hunkIdx: number, choice: HunkChoice | null) => {
    setChoices(prev => {
      const next = { ...(prev[path] ?? {}) }
      if (choice == null) delete next[hunkIdx]
      else next[hunkIdx] = choice
      return { ...prev, [path]: next }
    })
  }

  const applyAll = () => {
    for (const c of conflicts) {
      if (c.kind === 'conflictDeleted') {
        const choice = deletedChoice[c.path]
        if (choice) applyConflictResolution(c, choice)
        continue
      }
      const h = diffByLine(c.localContent, c.remoteContent)
      const merged = composeMerged(h, choices[c.path] ?? {})
      applyMergedConflict(c, merged)
    }
    closeTab(tabId)
    window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
  }

  if (!current) {
    return (
      <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText">
        No conflicts to resolve.
      </div>
    )
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-obsidianBlack">
      {/* Header */}
      <div className="px-4 py-2 border-b border-obsidianBorder space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Use the action links above each conflict to pick a side. Resolved regions collapse to the
            chosen content; hover them to revert.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            className="p-1 text-obsidianSecondaryText hover:text-obsidianText disabled:opacity-30"
            aria-label="Previous conflict"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm text-obsidianText truncate">{current.path}</code>
              {currentResolved && <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />}
            </div>
            <div className="text-xs text-obsidianSecondaryText">
              Conflict {currentIdx + 1} of {conflicts.length}
              {current.kind === 'conflict' && (
                <span> · {changeHunkIndices.length} region{changeHunkIndices.length === 1 ? '' : 's'}</span>
              )}
              <span> · {totalResolved}/{conflicts.length} resolved</span>
            </div>
          </div>
          <button
            onClick={() => setCurrentIdx(i => Math.min(conflicts.length - 1, i + 1))}
            disabled={currentIdx >= conflicts.length - 1}
            className="p-1 text-obsidianSecondaryText hover:text-obsidianText disabled:opacity-30"
            aria-label="Next conflict"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <div className="flex-shrink-0 flex items-center gap-2 pl-2 border-l border-obsidianBorder">
            <Button variant="ghost" onClick={() => closeTab(tabId)}>Cancel</Button>
            <Button variant="primary" onClick={applyAll} disabled={!allResolved}>
              Apply ({totalResolved}/{conflicts.length})
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {current.kind === 'conflictDeleted' ? (
          <DeletedConflictView
            localContent={current.localContent}
            choice={deletedChoice[current.path]}
            onChoose={(c) => setDeletedChoice(prev => ({ ...prev, [current.path]: c }))}
          />
        ) : (
          <MergeView
            hunks={hunks}
            choices={currentChoices}
            onChooseHunk={(i, c) => setHunkChoice(current.path, i, c)}
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
    <div className="font-mono text-xs border border-obsidianBorder rounded overflow-hidden">
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
            <div className="select-none w-10 text-right pr-2 py-0.5 text-obsidianSecondaryText/60 flex-shrink-0">
              {lineNo}
            </div>
            <pre className="flex-1 py-0.5 px-2 text-obsidianText whitespace-pre-wrap break-words min-w-0">
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
  <button onClick={onClick} className="text-obsidianAccentPurple hover:underline focus:outline-none">
    {children}
  </button>
)

const DeletedConflictView = ({
  localContent, choice, onChoose,
}: {
  localContent: string
  choice: 'local' | 'remote' | undefined
  onChoose: (c: 'local' | 'remote') => void
}) => (
  <div className="space-y-3 max-w-3xl">
    <div className="px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded text-sm text-amber-200">
      The remote file was deleted, but you have unsynced local edits. Keep your local copy (it
      will be re-created on next sync) or accept the deletion (the note will be moved to trash).
    </div>
    <div>
      <div className="text-xs text-obsidianSecondaryText mb-1 font-mono">Local content</div>
      <pre className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded p-2 whitespace-pre-wrap max-h-72 overflow-auto font-mono">
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
