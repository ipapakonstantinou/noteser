'use client'

import { useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useGitHubStore, useWorkspaceStore } from '@/stores'
import {
  classifyPendingChanges,
  totalPendingCount,
  type ChangeKind,
  type SyncChange,
} from '@/utils/syncChanges'

// VS Code-style source-control panel. Groups pending changes by their
// gitPath folder hierarchy: each directory is a collapsible row, each
// leaf is a note + status badge (A / M / D). Click a leaf to open the
// note. The previous flat created/modified/deleted bucket layout was
// fine for small vaults but unreadable past ~20 changes — the user
// asked for the tree (Telegram screenshot 2026-05-20).

interface TreeNode {
  // Folder segment name ('' = root) — empty for the synthetic root.
  segment: string
  // Children keyed by their segment.
  children: Map<string, TreeNode>
  // Leaf changes that live directly under this folder.
  leaves: Array<SyncChange & { kind: ChangeKind }>
}

function makeTreeRoot(): TreeNode {
  return { segment: '', children: new Map(), leaves: [] }
}

// Group every classified change into a nested folder tree. Pure for
// straightforward testability; exported so a future test can lock in
// the grouping shape.
export function groupChangesByFolder(
  created: SyncChange[],
  modified: SyncChange[],
  deleted: SyncChange[],
): TreeNode {
  const root = makeTreeRoot()
  const insert = (change: SyncChange, kind: ChangeKind) => {
    const path = change.gitPath ?? change.title
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) {
      root.leaves.push({ ...change, kind })
      return
    }
    // Last segment is the filename → leaf. Everything before is dir.
    let cur = root
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      let next = cur.children.get(seg)
      if (!next) {
        next = { segment: seg, children: new Map(), leaves: [] }
        cur.children.set(seg, next)
      }
      cur = next
    }
    cur.leaves.push({ ...change, kind })
  }
  for (const c of created)  insert(c, 'created')
  for (const m of modified) insert(m, 'modified')
  for (const d of deleted)  insert(d, 'deleted')
  return root
}

export function SourceControlPanel() {
  const notes = useNoteStore(s => s.notes)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const openNote = useWorkspaceStore(s => s.openNote)

  const changes = useMemo(
    () => classifyPendingChanges(notes, lastSyncedAt),
    [notes, lastSyncedAt],
  )
  const total = totalPendingCount(changes)

  const tree = useMemo(
    () => groupChangesByFolder(changes.created, changes.modified, changes.deleted),
    [changes],
  )

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
        <TreeView
          node={tree}
          depth={0}
          onOpen={(id) => openNote(id, { preview: false })}
        />
      )}
    </div>
  )
}

// Recursive tree renderer. Folders default to expanded; each remembers
// its own collapse state in component-local state so siblings can be
// collapsed independently. Keyed by the depth+segment path so React
// re-uses state across the same tree shape between renders.
const TreeView = ({
  node, depth, onOpen,
}: {
  node: TreeNode
  depth: number
  onOpen: (noteId: string) => void
}) => {
  // Render the folder children sorted alphabetically, then leaves.
  const folderEntries = useMemo(
    () => Array.from(node.children.values()).sort((a, b) => a.segment.localeCompare(b.segment)),
    [node],
  )
  return (
    <ul className="space-y-0.5">
      {folderEntries.map(child => (
        <li key={`d:${child.segment}`}>
          <Folder node={child} depth={depth} onOpen={onOpen} />
        </li>
      ))}
      {node.leaves.map(leaf => (
        <li key={`f:${leaf.noteId}`}>
          <Leaf leaf={leaf} depth={depth} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

const Folder = ({
  node, depth, onOpen,
}: { node: TreeNode; depth: number; onOpen: (id: string) => void }) => {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 px-1 py-0.5 text-xs text-obsidianSecondaryText hover:bg-obsidianHighlight/30 rounded"
        style={{ paddingLeft: `${depth * 10 + 4}px` }}
      >
        {open ? (
          <ChevronDownIcon className="w-3 h-3" />
        ) : (
          <ChevronRightIcon className="w-3 h-3" />
        )}
        <span className="truncate">{node.segment}</span>
      </button>
      {open && (
        <TreeView node={node} depth={depth + 1} onOpen={onOpen} />
      )}
    </>
  )
}

const Leaf = ({
  leaf, depth, onOpen,
}: {
  leaf: SyncChange & { kind: ChangeKind }
  depth: number
  onOpen: (id: string) => void
}) => (
  <button
    type="button"
    onClick={() => onOpen(leaf.noteId)}
    className="w-full flex items-center gap-1.5 px-1 py-0.5 text-xs text-left rounded hover:bg-obsidianHighlight/40 group"
    title={leaf.gitPath ?? leaf.title}
    style={{ paddingLeft: `${depth * 10 + 16}px` }}
    data-testid={`source-control-row-${leaf.noteId}`}
  >
    <span
      className={`truncate flex-1 ${leaf.kind === 'deleted' ? 'line-through text-obsidianSecondaryText' : 'text-obsidianText'}`}
    >
      {filename(leaf)}
    </span>
    <KindBadge kind={leaf.kind} />
  </button>
)

// Show a one-letter VS-Code-style badge — A added, M modified, D deleted.
// Colour matches the badge convention so the row scans visually even
// before the user reads the filename.
const KindBadge = ({ kind }: { kind: ChangeKind }) => {
  const map: Record<ChangeKind, { letter: string; cls: string }> = {
    created:  { letter: 'A', cls: 'text-green-400' },
    modified: { letter: 'M', cls: 'text-yellow-400' },
    deleted:  { letter: 'D', cls: 'text-red-400' },
  }
  const { letter, cls } = map[kind]
  return (
    <span
      className={`flex-none w-3 text-right font-mono text-[10px] ${cls}`}
      data-testid={`source-control-badge-${kind}`}
    >
      {letter}
    </span>
  )
}

// Pull just the filename (last segment) out of a gitPath, falling back
// to the note title when the change has no path yet (newly created).
function filename(leaf: SyncChange & { kind: ChangeKind }): string {
  if (!leaf.gitPath) return leaf.title || 'Untitled'
  const idx = leaf.gitPath.lastIndexOf('/')
  return idx === -1 ? leaf.gitPath : leaf.gitPath.slice(idx + 1)
}
