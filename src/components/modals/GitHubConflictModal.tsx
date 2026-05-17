'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore } from '@/stores'
import { applyConflictResolution, applyMergedConflict } from '@/utils/syncApply'
import type { PullClassification } from '@/utils/githubSync'
import { diffByLine, composeMerged, type DiffHunk } from '@/utils/lineDiff'

// Just the two kinds we surface to the user.
type ConflictItem = Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>
type HunkChoice = 'local' | 'remote' | 'both' | 'skip'
// Per-conflict (keyed by path) → per-hunk-index → choice
type ChoiceMap = Record<string, Record<number, HunkChoice>>

export const SYNC_REQUEST_EVENT = 'noteser:sync-request'

export const GitHubConflictModal = () => {
  const { modal, closeModal } = useUIStore()

  const conflicts = useMemo<ConflictItem[]>(() => {
    const raw = modal.data?.conflicts
    return Array.isArray(raw) ? (raw as ConflictItem[]) : []
  }, [modal.data])

  const [currentIdx, setCurrentIdx] = useState(0)
  const [choices, setChoices] = useState<ChoiceMap>({})
  // conflictDeleted gets a simpler L/R toggle stored alongside (same map).
  const [deletedChoice, setDeletedChoice] = useState<Record<string, 'local' | 'remote'>>({})

  // Reset state whenever a new set of conflicts comes in.
  useEffect(() => {
    setCurrentIdx(0)
    setChoices({})
    setDeletedChoice({})
  }, [conflicts])

  const isOpen = modal.type === 'github-conflicts'
  const current = conflicts[currentIdx]

  // Compute hunks for the current conflict (only when it's a content conflict).
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

  const setHunkChoice = (path: string, hunkIdx: number, choice: HunkChoice) => {
    setChoices(prev => ({
      ...prev,
      [path]: { ...(prev[path] ?? {}), [hunkIdx]: choice },
    }))
  }

  const applyAll = () => {
    for (const c of conflicts) {
      if (c.kind === 'conflictDeleted') {
        const choice = deletedChoice[c.path]
        if (choice) applyConflictResolution(c, choice)
        continue
      }
      // Content conflict: build merged file from the per-hunk choices.
      const h = diffByLine(c.localContent, c.remoteContent)
      const merged = composeMerged(h, choices[c.path] ?? {})
      applyMergedConflict(c, merged)
    }
    closeModal()
    window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
  }

  if (!isOpen || conflicts.length === 0 || !current) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title={`Resolve conflicts (${totalResolved}/${conflicts.length})`}
      size="xl"
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Pick which side wins for each region. <strong>Local</strong> keeps your edit,{' '}
            <strong>Remote</strong> takes GitHub&rsquo;s version, <strong>Both</strong> keeps both
            (yours first). Resolved regions tint purple.
          </span>
        </div>

        {/* Navigator */}
        <div className="flex items-center gap-2 border border-obsidianBorder rounded px-2 py-1.5">
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
        </div>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
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

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-obsidianBorder">
          <Button variant="ghost" onClick={closeModal}>Cancel</Button>
          <Button variant="primary" onClick={applyAll} disabled={!allResolved}>
            Apply ({totalResolved}/{conflicts.length})
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Merge view (one conflict, all hunks scrollable) ─────────────────────────

const MergeView = ({
  hunks,
  choices,
  onChooseHunk,
}: {
  hunks: DiffHunk[]
  choices: Record<number, HunkChoice>
  onChooseHunk: (hunkIdx: number, choice: HunkChoice) => void
}) => (
  <div className="font-mono text-xs space-y-1">
    {hunks.map((h, i) => {
      if (h.type === 'equal') {
        return (
          <pre key={i} className="px-3 py-0.5 text-obsidianText whitespace-pre-wrap">
            {h.lines.length === 0 ? ' ' : h.lines.join('\n')}
          </pre>
        )
      }
      const choice = choices[i]
      return (
        <div
          key={i}
          className={`my-1 border rounded ${
            choice ? 'border-obsidianAccentPurple/40 bg-obsidianAccentPurple/5' : 'border-obsidianBorder'
          }`}
        >
          <div className={`px-2 py-1 ${choice && choice !== 'remote' ? 'bg-red-950/40' : 'bg-red-950/20'}`}>
            <div className="text-[10px] uppercase tracking-wide text-red-400 mb-0.5">Local</div>
            {h.localLines.length === 0 ? (
              <div className="italic text-obsidianSecondaryText">(empty)</div>
            ) : (
              <pre className="whitespace-pre-wrap text-obsidianText">{h.localLines.join('\n')}</pre>
            )}
          </div>
          <div className={`px-2 py-1 ${choice && choice !== 'local' ? 'bg-green-950/40' : 'bg-green-950/20'}`}>
            <div className="text-[10px] uppercase tracking-wide text-green-400 mb-0.5">Remote</div>
            {h.remoteLines.length === 0 ? (
              <div className="italic text-obsidianSecondaryText">(empty)</div>
            ) : (
              <pre className="whitespace-pre-wrap text-obsidianText">{h.remoteLines.join('\n')}</pre>
            )}
          </div>
          <div className="flex items-center gap-1 px-2 py-1.5 border-t border-obsidianBorder">
            <ChoiceButton label="Local"  active={choice === 'local'}  onClick={() => onChooseHunk(i, 'local')} />
            <ChoiceButton label="Remote" active={choice === 'remote'} onClick={() => onChooseHunk(i, 'remote')} />
            <ChoiceButton label="Both"   active={choice === 'both'}   onClick={() => onChooseHunk(i, 'both')} />
            <ChoiceButton label="Skip"   active={choice === 'skip'}   onClick={() => onChooseHunk(i, 'skip')} subtle />
          </div>
        </div>
      )
    })}
  </div>
)

const ChoiceButton = ({
  label, active, onClick, subtle = false,
}: { label: string; active: boolean; onClick: () => void; subtle?: boolean }) => (
  <button
    onClick={onClick}
    className={`px-2 py-1 rounded text-xs transition-colors ${
      active
        ? 'bg-obsidianAccentPurple text-white'
        : subtle
          ? 'text-obsidianSecondaryText hover:bg-obsidianHighlight'
          : 'bg-obsidianDarkGray text-obsidianText hover:bg-obsidianHighlight'
    }`}
  >
    {label}
  </button>
)

// ── conflictDeleted view (remote gone, local edited) ────────────────────────

const DeletedConflictView = ({
  localContent, choice, onChoose,
}: {
  localContent: string
  choice: 'local' | 'remote' | undefined
  onChoose: (c: 'local' | 'remote') => void
}) => (
  <div className="space-y-3">
    <div className="px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded text-sm text-amber-200">
      The remote file was deleted, but you have unsynced local edits. Keep your local copy
      (it will be re-created on next sync) or accept the deletion (the note will be moved to trash).
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

export default GitHubConflictModal
