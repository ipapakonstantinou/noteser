'use client'

import { useEffect, useState } from 'react'
import { ClockIcon, ArrowUturnLeftIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useNoteStore, useGitHubStore } from '@/stores'
import { listFileCommits, getFileContentAtCommit, formatRelativeAuthorDate } from '@/utils/githubHistory'
import { GitHubAPIError } from '@/utils/github'
import { parseNote } from '@/utils/githubSync'
import { bodyWithInlineTags } from '@/utils/syncApply'
import type { FileCommitEntry } from '@/utils/githubHistory'

// "View history" surface for a single pushed note. Lists the commits
// that touched the note's gitPath, lets the user open any version
// as a read-only preview pane, and restore-to-this-version with one
// click. Gated on note.gitPath != null — unsynced notes have nothing
// to show.
//
// Opens via useUIStore.openModal({ type: 'file-history', data: { noteId } }).

interface FileHistoryData {
  noteId: string
}

export const FileHistoryModal = () => {
  const { modal, closeModal } = useUIStore()
  const data = modal.data as FileHistoryData | undefined
  const isOpen = modal.type === 'file-history'

  const note = useNoteStore(s => data ? s.notes.find(n => n.id === data.noteId) : undefined)
  const updateNote = useNoteStore(s => s.updateNote)
  const token = useGitHubStore(s => s.token)
  const repo = useGitHubStore(s => s.syncRepo)

  const [commits, setCommits] = useState<FileCommitEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  // Reset state every time the modal re-opens for a fresh note.
  useEffect(() => {
    if (!isOpen) return
    setCommits(null)
    setError(null)
    setSelectedSha(null)
    setSelectedContent(null)
    setContentError(null)
  }, [isOpen, data?.noteId])

  // Fetch the commit list once we know we have a note + repo + token.
  useEffect(() => {
    if (!isOpen) return
    if (!token || !repo || !note || !note.gitPath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listFileCommits(token, repo.owner, repo.name, note.gitPath, { perPage: 30 })
      .then(list => {
        if (cancelled) return
        setCommits(list)
        if (list.length > 0) setSelectedSha(list[0].sha)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof GitHubAPIError
          ? err.isRateLimit
            ? `GitHub rate-limited — try again in ${err.resetInSeconds() ?? '?'}s`
            : err.message
          : (err as Error).message
        setError(msg)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, token, repo, note])

  // Fetch the content for the selected commit. parseNote strips any
  // legacy frontmatter and re-emits the body with inline tags so the
  // restored note matches what the live editor would write.
  useEffect(() => {
    if (!isOpen) return
    if (!token || !repo || !note || !note.gitPath || !selectedSha) return
    let cancelled = false
    setContentLoading(true)
    setContentError(null)
    getFileContentAtCommit(token, repo.owner, repo.name, note.gitPath, selectedSha)
      .then(raw => {
        if (cancelled) return
        const parsed = parseNote(raw)
        setSelectedContent(bodyWithInlineTags(parsed.body, parsed.tags))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof GitHubAPIError ? err.message : (err as Error).message
        setContentError(msg)
        setSelectedContent(null)
      })
      .finally(() => { if (!cancelled) setContentLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, token, repo, note, selectedSha])

  if (!isOpen) return null
  if (!note) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="File history" size="lg">
        <div className="text-sm text-obsidianSecondaryText">Note not found.</div>
      </Modal>
    )
  }
  if (!note.gitPath) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="File history" size="lg">
        <div className="flex items-start gap-2 text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>This note hasn&apos;t been pushed yet — no commit history exists for it.</span>
        </div>
      </Modal>
    )
  }
  if (!token || !repo) {
    return (
      <Modal isOpen={isOpen} onClose={closeModal} title="File history" size="lg">
        <div className="text-sm text-obsidianSecondaryText">
          Connect a GitHub repo in Settings → GitHub sync to view file history.
        </div>
      </Modal>
    )
  }

  const restore = () => {
    if (selectedContent == null) return
    setRestoring(true)
    try {
      // Update the local content. Push on next sync will upload the
      // restored version as a new commit — the history grows, the old
      // versions stay accessible.
      updateNote(note.id, { content: selectedContent })
      closeModal()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={`History — ${note.title}`} size="2xl" bodyless>
      <div className="flex h-[60dvh] min-h-[420px]">
        {/* Commit list — left column */}
        <div className="w-72 flex-none border-r border-obsidianBorder overflow-y-auto" data-testid="file-history-list">
          {loading && (
            <div className="p-4 text-xs text-obsidianSecondaryText">Loading commits…</div>
          )}
          {error && (
            <div className="p-4 text-xs text-red-400 flex items-start gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && commits && commits.length === 0 && (
            <div className="p-4 text-xs text-obsidianSecondaryText">
              No commits found for this file. (Did the path change recently? Try syncing first.)
            </div>
          )}
          {commits && commits.map(c => {
            const active = c.sha === selectedSha
            return (
              <button
                key={c.sha}
                type="button"
                onClick={() => setSelectedSha(c.sha)}
                className={`w-full text-left px-3 py-2 border-b border-obsidianBorder text-xs transition-colors ${
                  active
                    ? 'bg-obsidianAccentPurple/15 border-l-2 border-l-obsidianAccentPurple pl-[10px] text-obsidianText'
                    : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText'
                }`}
                data-testid="file-history-row"
              >
                <div className="flex items-center gap-2">
                  <code className="text-[10px] text-obsidianAccentPurple flex-none">{c.shortSha}</code>
                  <span className="text-[10px] text-obsidianSecondaryText flex-1 text-right">{formatRelativeAuthorDate(c.authorDate)}</span>
                </div>
                <div className="mt-1 line-clamp-2 leading-snug">{c.message || '(no message)'}</div>
                <div className="mt-1 text-[10px] text-obsidianSecondaryText truncate">{c.authorName}</div>
              </button>
            )
          })}
        </div>

        {/* Preview + actions — right column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-obsidianBorder flex-none">
            <ClockIcon className="w-4 h-4 text-obsidianSecondaryText" />
            <div className="text-sm text-obsidianText flex-1 truncate">
              {selectedSha ? (
                commits?.find(c => c.sha === selectedSha)?.message ?? selectedSha
              ) : 'Select a commit'}
            </div>
            {selectedSha && commits && (
              <a
                href={commits.find(c => c.sha === selectedSha)?.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
                title="Open commit on GitHub"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs whitespace-pre-wrap" data-testid="file-history-preview">
            {contentLoading && <div className="text-obsidianSecondaryText">Loading content…</div>}
            {contentError && (
              <div className="text-red-400 flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{contentError}</span>
              </div>
            )}
            {!contentLoading && !contentError && selectedContent != null && (
              <pre className="text-obsidianText leading-relaxed">{selectedContent || '(empty file)'}</pre>
            )}
            {!contentLoading && !contentError && selectedContent == null && !selectedSha && (
              <div className="text-obsidianSecondaryText">Pick a commit from the list to see its content.</div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-obsidianBorder flex items-center justify-end gap-2 flex-none">
            <Button variant="ghost" onClick={closeModal}>Close</Button>
            <Button
              variant="primary"
              onClick={restore}
              disabled={selectedContent == null || contentLoading || restoring}
              data-testid="file-history-restore"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
              {restoring ? 'Restoring…' : 'Restore this version'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default FileHistoryModal
