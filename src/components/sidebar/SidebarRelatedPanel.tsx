'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LinkIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import {
  getEmbedding,
  indexNote,
  listAllEmbeddings,
  topRelated,
  type RelatedNote,
} from '@/utils/embeddings'
import { EMBEDDING_CHANGED_EVENT } from '@/utils/events'

// Related-notes panel. Surfaces the top cosine-similar notes to the
// currently-active note. If the active note hasn't been embedded yet
// we offer a single-click "Index this note" button — bulk indexing
// lives in Settings → AI to keep this panel uncluttered.
export const SidebarRelatedPanel = () => {
  const notes = useNoteStore(s => s.notes)
  const openNote = useWorkspaceStore(s => s.openNote)
  const panes = useWorkspaceStore(s => s.panes)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const aiProvider = useSettingsStore(s => s.aiProvider)
  const embeddingsEnabled = useSettingsStore(s => s.aiEmbeddingsEnabled)

  // Resolve the active note id from workspace state.
  const activeNoteId = useMemo(() => {
    const pane = panes.find(p => p.id === activePaneId) ?? panes[0]
    const tab = pane?.tabs.find(t => t.id === pane?.activeTabId)
    return tab?.kind === 'note' ? tab.noteId : null
  }, [panes, activePaneId])

  const activeNote = useMemo(
    () => activeNoteId ? notes.find(n => n.id === activeNoteId) : null,
    [notes, activeNoteId],
  )

  const [related, setRelated] = useState<RelatedNote[] | null>(null)
  const [missingEmbedding, setMissingEmbedding] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setErrorMsg(null)
    if (!activeNote) {
      setRelated([])
      setMissingEmbedding(false)
      return
    }
    const active = await getEmbedding(activeNote.id)
    if (!active) {
      setMissingEmbedding(true)
      setRelated([])
      return
    }
    setMissingEmbedding(false)
    const all = await listAllEmbeddings()
    const allowedIds = new Set(notes.filter(n => !n.isDeleted).map(n => n.id))
    const candidates = all.filter(e => allowedIds.has(e.noteId))
    setRelated(topRelated(active.vector, candidates, active.noteId, 8))
  }, [activeNote, notes])

  // Re-compute on active-note change.
  useEffect(() => { void refresh() }, [refresh])

  // Phase B: also refresh whenever any note's embedding lands, so the
  // ranking reflects fresh edits without a manual click on the spinner.
  useEffect(() => {
    const handler = () => { void refresh() }
    window.addEventListener(EMBEDDING_CHANGED_EVENT, handler)
    return () => window.removeEventListener(EMBEDDING_CHANGED_EVENT, handler)
  }, [refresh])

  const handleIndexThis = useCallback(async () => {
    if (!activeNote) return
    setIndexing(true)
    setErrorMsg(null)
    try {
      await indexNote(activeNote)
      await refresh()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Indexing failed.')
    } finally {
      setIndexing(false)
    }
  }, [activeNote, refresh])

  // Off-state CTAs — different messaging for each disabled reason.
  if (!embeddingsEnabled) {
    return (
      <div className="px-3 py-4 text-xs text-obsidianSecondaryText space-y-2">
        <div className="flex items-center gap-1.5">
          <LinkIcon className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wide font-medium">Related notes</span>
        </div>
        <p>Turn on AI embeddings in Settings → AI to surface notes by semantic similarity.</p>
      </div>
    )
  }
  if (aiProvider !== 'openai') {
    return (
      <div className="px-3 py-4 text-xs text-obsidianSecondaryText space-y-2">
        <div className="flex items-center gap-1.5">
          <LinkIcon className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wide font-medium">Related notes</span>
        </div>
        <p>Embeddings require an OpenAI API key. Switch the AI provider to OpenAI in Settings → AI.</p>
      </div>
    )
  }
  if (!activeNote) {
    return (
      <div className="px-3 py-4 text-xs text-obsidianSecondaryText italic">
        Open a note to see related notes.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-obsidianBorder">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
          <LinkIcon className="w-3.5 h-3.5" />
          Related to
          <span className="text-obsidianText normal-case truncate max-w-[8rem]" title={activeNote.title}>
            {activeNote.title || 'Untitled'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Refresh"
          className="p-1 rounded text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianHighlight/40"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {missingEmbedding ? (
          <div className="px-3 py-4 space-y-2 text-xs">
            <p className="text-obsidianSecondaryText">
              This note hasn&apos;t been indexed yet.
            </p>
            <button
              type="button"
              onClick={handleIndexThis}
              disabled={indexing}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-obsidianAccentPurple text-white hover:opacity-90 disabled:opacity-60"
              data-testid="related-index-this"
            >
              <SparklesIcon className="w-3.5 h-3.5" />
              {indexing ? 'Indexing…' : 'Index this note'}
            </button>
            {errorMsg && (
              <p className="text-red-400">{errorMsg}</p>
            )}
            <p className="text-obsidianSecondaryText/70">
              Tip: use Settings → AI → &quot;Index all notes&quot; to bulk-index your vault.
            </p>
          </div>
        ) : related && related.length === 0 ? (
          <div className="px-3 py-4 text-xs text-obsidianSecondaryText italic">
            No related notes yet. Index more notes from Settings → AI.
          </div>
        ) : (
          <ul className="py-1">
            {(related ?? []).map(r => {
              const note = notes.find(n => n.id === r.noteId)
              if (!note) return null
              return (
                <li key={r.noteId}>
                  <button
                    type="button"
                    onClick={() => openNote(r.noteId, { preview: true })}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left text-obsidianText hover:bg-obsidianHighlight/40"
                    title={note.title}
                    data-testid={`related-${r.noteId}`}
                  >
                    <span className="truncate">{note.title || 'Untitled'}</span>
                    <span className="text-[10px] text-obsidianSecondaryText/70 flex-none font-mono">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default SidebarRelatedPanel
