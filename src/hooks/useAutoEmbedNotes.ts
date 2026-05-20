'use client'

import { useEffect, useRef } from 'react'
import { useNoteStore, useSettingsStore } from '@/stores'
import { buildEmbedInput, hashContent, indexNote } from '@/utils/embeddings'
import type { Note } from '@/types'

// Auto re-index embeddings on note save (a1f7 phase B).
//
// Subscribes to noteStore once at mount. When a note's embedding-input
// hash drifts (title or content changed in a way that matters to the
// model), schedule a 5s-debounced indexNote() call. Per-note timers so
// rapid edits across multiple notes don't starve each other.
//
// Errors are swallowed by design — a stale OpenAI key or a 429 should
// NOT flash an alert on every keystroke. The user sees failures only
// when they explicitly try to refresh the Related panel or the active
// note's "Index this note" button.

const DEBOUNCE_MS = 5000

export function useAutoEmbedNotes(): void {
  // Cache the LAST-seen hash per noteId so we only re-index when the
  // embedding input actually drifted. Survives the lifetime of the
  // mounted hook; cleared on unmount via the cleanup below.
  const lastHashRef = useRef<Map<string, string>>(new Map())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const lastHashes = lastHashRef.current
    const timers = timersRef.current

    // Seed the hash cache with whatever's currently in the store so
    // the FIRST tick after mount doesn't fire an embed for every
    // note. We use the embedding input (title + body trimmed +
    // bounded) so the hash matches what indexNote will compute later.
    for (const n of useNoteStore.getState().notes) {
      if (n.isDeleted) continue
      const input = buildEmbedInput(n)
      if (input) lastHashes.set(n.id, hashContent(input))
    }

    const onChange = () => {
      const { aiEmbeddingsEnabled, aiProvider, aiApiKey } = useSettingsStore.getState()
      // Gating — if any precondition is missing, just skip. We don't
      // clear the cached hashes here because re-enabling shouldn't
      // re-embed every note: indexNote already compares against the
      // IDB-stored hash on each call.
      if (!aiEmbeddingsEnabled) return
      if (aiProvider !== 'openai' || !aiApiKey) return

      const notes = useNoteStore.getState().notes
      for (const n of notes) {
        if (n.isDeleted) {
          // If a previously-tracked note got soft-deleted, drop its
          // entry so a future un-delete + edit re-triggers an embed.
          lastHashes.delete(n.id)
          const t = timers.get(n.id)
          if (t) { clearTimeout(t); timers.delete(n.id) }
          continue
        }
        const input = buildEmbedInput(n)
        if (!input) continue
        const h = hashContent(input)
        if (lastHashes.get(n.id) === h) continue
        lastHashes.set(n.id, h)

        // Replace any pending timer for this note so the debounce
        // resets on each new keystroke.
        const existing = timers.get(n.id)
        if (existing) clearTimeout(existing)
        const noteCopy: Pick<Note, 'id' | 'title' | 'content'> = { id: n.id, title: n.title, content: n.content }
        const timer = setTimeout(() => {
          timers.delete(n.id)
          // Re-check gating at fire time too — user might have
          // toggled the feature off during the debounce window.
          const s = useSettingsStore.getState()
          if (!s.aiEmbeddingsEnabled || s.aiProvider !== 'openai' || !s.aiApiKey) return
          // Re-read current note in case the user typed more after
          // we captured the snapshot — gives the freshest content.
          const cur = useNoteStore.getState().notes.find(x => x.id === noteCopy.id)
          if (!cur || cur.isDeleted) return
          void indexNote(cur).catch(() => {
            // Silent — see the file-level comment. Failures show up
            // when the user pulls on the Related panel or the manual
            // index button surfaces them.
          })
        }, DEBOUNCE_MS)
        timers.set(n.id, timer)
      }
    }

    const unsub = useNoteStore.subscribe(onChange)
    return () => {
      unsub()
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      lastHashes.clear()
    }
  }, [])
}
