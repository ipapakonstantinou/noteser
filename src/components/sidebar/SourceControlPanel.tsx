'use client'

import { useMemo } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useGitHubStore, useWorkspaceStore } from '@/stores'
import { classifyPendingChanges, totalPendingCount, type ChangeKind, type SyncChange } from '@/utils/syncChanges'

// VS Code-style source-control panel. Lists pending changes (created /
// modified / deleted) that the next push will include. Click a row to
// open the underlying note. v1 doesn't have per-file include/exclude or
// inline diff preview — those come in v2 once the user has used this
// long enough to tell us what they actually need.

export function SourceControlPanel() {
  const notes = useNoteStore(s => s.notes)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const openNote = useWorkspaceStore(s => s.openNote)

  const changes = useMemo(
    () => classifyPendingChanges(notes, lastSyncedAt),
    [notes, lastSyncedAt],
  )
  const total = totalPendingCount(changes)

  return (
    <div className="space-y-1" data-testid="source-control-panel">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
          Source control
        </div>
        <span
          className="text-[11px] font-mono text-obsidianSecondaryText"
          data-testid="source-control-count"
        >
          {total > 0 ? `${total} pending` : 'clean'}
        </span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-obsidianSecondaryText italic px-1">
          No pending changes. Your vault is in sync with the remote.
        </p>
      ) : (
        <div className="space-y-2">
          <Bucket
            kind="created"
            label="Created"
            items={changes.created}
            onOpen={(id) => openNote(id, { preview: false })}
          />
          <Bucket
            kind="modified"
            label="Modified"
            items={changes.modified}
            onOpen={(id) => openNote(id, { preview: false })}
          />
          <Bucket
            kind="deleted"
            label="Deleted"
            items={changes.deleted}
            onOpen={(id) => openNote(id, { preview: false })}
          />
        </div>
      )}
    </div>
  )
}

function Bucket({
  kind,
  label,
  items,
  onOpen,
}: {
  kind: ChangeKind
  label: string
  items: SyncChange[]
  onOpen: (noteId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div data-testid={`source-control-bucket-${kind}`}>
      <div className="text-[10px] uppercase tracking-wider text-obsidianSecondaryText/80 px-1 py-0.5">
        {label} ({items.length})
      </div>
      <ul className="space-y-0.5">
        {items.map(it => (
          <li key={it.noteId}>
            <button
              type="button"
              onClick={() => onOpen(it.noteId)}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 text-xs text-left rounded hover:bg-obsidianHighlight/40 group"
              title={it.gitPath ?? it.title}
              data-testid={`source-control-row-${it.noteId}`}
            >
              <KindIcon kind={kind} />
              <span className={`truncate flex-1 ${kind === 'deleted' ? 'line-through text-obsidianSecondaryText' : 'text-obsidianText'}`}>
                {it.title}
              </span>
              {it.gitPath && it.gitPath !== it.title && (
                <span className="text-[10px] text-obsidianSecondaryText/60 truncate max-w-[60%]">
                  {shortenPath(it.gitPath)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindIcon({ kind }: { kind: ChangeKind }) {
  const cls = 'w-3 h-3 flex-none'
  switch (kind) {
    case 'created':
      return <PlusIcon className={`${cls} text-green-400`} />
    case 'modified':
      return <PencilIcon className={`${cls} text-yellow-400`} />
    case 'deleted':
      return <TrashIcon className={`${cls} text-red-400`} />
  }
}

// "Daily-Notes/2026-05-20.md" → "Daily-Notes/2026-05-20.md" (no-op if short),
// or ".../2026-05-20.md" when the path is too long for the row.
function shortenPath(p: string): string {
  const MAX = 36
  if (p.length <= MAX) return p
  return `…/${p.slice(-(MAX - 2))}`
}
