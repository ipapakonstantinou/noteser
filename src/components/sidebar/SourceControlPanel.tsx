'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useGitHubStore, useWorkspaceStore, useUIStore, useFolderStore } from '@/stores'
import {
  classifyPendingChanges,
  totalPendingCount,
  type ChangeKind,
  type SyncChange,
} from '@/utils/syncChanges'
import { listRecentCommits, formatRelativeAuthorDate, type FileCommitEntry } from '@/utils/githubHistory'
import { GitHubAPIError } from '@/utils/github'
import { withTokenRefresh, ReconnectRequiredError } from '@/utils/tokenRefresh'

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

// Branches git hosts treat as the repo default — we omit the branch suffix
// for these so the link lands on the repo root.
const DEFAULT_BRANCHES = new Set(['main', 'master'])

// Build the web URL for the configured vault repo. Host-aware:
// - GitHub  → https://github.com/{owner}/{name}[/tree/{branch}]
// - Forgejo → {baseUrl}/{owner}/{name}[/src/branch/{branch}]
//   (Gitea/Codeberg uses /src/branch/ instead of GitHub's /tree/)
function repoWebUrl(
  repo: { owner: string; name: string; branch: string },
  host: 'github' | 'forgejo',
  baseUrl: string | null,
): string {
  if (host === 'forgejo') {
    const base = (baseUrl ?? 'https://codeberg.org').replace(/\/+$/, '')
    const root = `${base}/${repo.owner}/${repo.name}`
    return DEFAULT_BRANCHES.has(repo.branch) ? root : `${root}/src/branch/${repo.branch}`
  }
  // GitHub
  const base = `https://github.com/${repo.owner}/${repo.name}`
  return DEFAULT_BRANCHES.has(repo.branch) ? base : `${base}/tree/${repo.branch}`
}

export function SourceControlPanel() {
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const host = useGitHubStore(s => s.host)
  const baseUrl = useGitHubStore(s => s.baseUrl)
  const openNote = useWorkspaceStore(s => s.openNote)

  // Pass `folders` so created (never-pushed) notes carry a synthetic
  // gitPath derived from their folder hierarchy — that's what lets
  // groupChangesByFolder below nest them under the right directory
  // instead of dumping them at the root (the
  // fix/created-note-source-control-tree-bug fix).
  const changes = useMemo(
    () => classifyPendingChanges(notes, lastSyncedAt, folders),
    [notes, lastSyncedAt, folders],
  )
  const total = totalPendingCount(changes)

  const tree = useMemo(
    () => groupChangesByFolder(changes.created, changes.modified, changes.deleted),
    [changes],
  )

  return (
    <div className="space-y-1" data-testid="source-control-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText flex-none">
            Source control
          </span>
          {syncRepo && (
            <>
              <span className="text-[11px] text-obsidianSecondaryText/60 flex-none">·</span>
              <span
                className="text-[11px] font-mono text-obsidianSecondaryText truncate"
                title={`${syncRepo.owner}/${syncRepo.name}`}
                data-testid="source-control-repo-name"
              >
                {syncRepo.owner}/{syncRepo.name}
              </span>
              <a
                href={repoWebUrl(syncRepo, host, baseUrl)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex-none text-obsidianSecondaryText hover:text-obsidianText transition-colors"
                data-noteser-tip={host === 'github' ? 'Open in GitHub' : 'Open in browser'}
                data-testid="source-control-open-github"
                aria-label={host === 'github' ? 'Open in GitHub' : 'Open in browser'}
              >
                <ArrowTopRightOnSquareIcon className="w-3 h-3" />
              </a>
            </>
          )}
        </div>
        <span
          className="text-[11px] font-mono text-obsidianSecondaryText flex-none ml-2"
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

      <RecentCommits />
    </div>
  )
}

// Last-N commits on the connected branch. Sits below the pending tree
// so the user can see "what was just pushed" without leaving the app.
// Fetches once on mount + after each successful sync (signalled by the
// store's lastCommitSha changing). Skips entirely when no repo is
// connected.
const RecentCommits = () => {
  const token = useGitHubStore(s => s.token)
  const repo = useGitHubStore(s => s.syncRepo)
  const lastCommitSha = useGitHubStore(s => s.lastCommitSha)
  const isGitHubHost = useGitHubStore(s => s.host === 'github')
  const [open, setOpen] = useState(true)
  const [commits, setCommits] = useState<FileCommitEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refetch keyed on (repo + lastCommitSha). lastCommitSha is updated
  // by useGitHubSync.runSync on success, so any local-driven push
  // surfaces a fresh list automatically. Manual remote-driven pushes
  // (e.g. another device synced something) also propagate once the
  // user runs sync, since the pull updates lastCommitSha too.
  useEffect(() => {
    if (!token || !repo) {
      setCommits(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    // Wrap in token refresh: an expired token auto-renews instead of 401-ing
    // the panel (matches how the sync pull/push are wrapped).
    withTokenRefresh(tok => listRecentCommits(tok, repo.owner, repo.name, repo.branch, { perPage: 15 }))
      .then(list => { if (!cancelled) setCommits(list) })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof ReconnectRequiredError
          ? err.message
          : err instanceof GitHubAPIError
            ? (err.isRateLimit ? 'GitHub rate-limited — recent commits unavailable' : err.message)
            : (err as Error).message
        setError(msg)
        setCommits(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, repo, lastCommitSha])

  if (!token || !repo || !isGitHubHost) return null

  return (
    <div className="mt-3 pt-2 border-t border-obsidianBorder" data-testid="source-control-recent-commits">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 px-1 py-0.5 text-[11px] uppercase tracking-wide text-obsidianSecondaryText hover:text-obsidianText"
      >
        {open ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
        Recent commits
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {loading && <div className="px-2 py-1 text-xs text-obsidianSecondaryText italic">Loading…</div>}
          {error && <div className="px-2 py-1 text-xs text-red-400">{error}</div>}
          {!loading && !error && commits && commits.length === 0 && (
            <div className="px-2 py-1 text-xs text-obsidianSecondaryText italic">No commits yet on this branch.</div>
          )}
          {commits && commits.map(c => (
            <CommitRow key={c.sha} commit={c} />
          ))}
        </div>
      )}
    </div>
  )
}

// Single row in the Recent commits list. Splits the "open on GitHub"
// link from the "revert vault to this commit" action so we don't nest
// interactive elements inside an anchor (invalid HTML, and Safari
// disables the inner button on touch).
const CommitRow = ({ commit }: { commit: FileCommitEntry }) => {
  const openModal = useUIStore(s => s.openModal)
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-obsidianHighlight/40 rounded"
      title={`${commit.shortSha} · ${commit.authorName} · ${commit.message || '(no message)'}`}
      data-testid="recent-commit-row"
    >
      <a
        href={commit.htmlUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 flex items-center gap-1.5 text-obsidianText min-w-0"
        data-testid="recent-commit-link"
      >
        <code className="flex-none text-[10px] text-obsidianAccentPurple font-mono">{commit.shortSha}</code>
        <span className="flex-1 truncate text-obsidianSecondaryText">{commit.message || '(no message)'}</span>
        <span className="flex-none text-[10px] text-obsidianSecondaryText">{formatRelativeAuthorDate(commit.authorDate)}</span>
        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-none text-obsidianSecondaryText" />
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          openModal({
            type: 'revert-to-commit',
            data: {
              commitSha: commit.sha,
              shortSha: commit.shortSha,
              message: commit.message,
            },
          })
        }}
        title="Revert vault to this commit"
        className="p-0.5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors flex-none"
        data-testid="recent-commit-revert"
      >
        <ArrowUturnLeftIcon className="w-3 h-3" />
      </button>
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
