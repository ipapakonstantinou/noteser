'use client'

import { useEffect, useState } from 'react'
import { useNoteStore, useUIStore } from '@/stores'
import { ensureNoteBodyLoaded } from '@/utils/backgroundFill'
import { VaultLockedError } from '@/utils/vaultKey'

// progressive-clone on-open fetch: when the user opens a note that is still a
// SHELL (body not yet streamed in by the background fill), fetch its body
// immediately so they don't have to wait for the background pass to reach it.
//
// Returns `true` while the opened note is a shell whose body is still loading,
// so the editor can show a brief "Loading note…" hint. Flips to false the
// moment the body lands (the note's contentLoaded becomes true). For normal
// (already-loaded) notes this is always false and fires no work.
export function useEnsureNoteLoaded(noteId: string | null | undefined): boolean {
  // Subscribe to THIS note's contentLoaded so the hint clears reactively when
  // the background fill (or our own fetch) patches the body in.
  const isShell = useNoteStore((s) => {
    if (!noteId) return false
    const note = s.notes.find(n => n.id === noteId)
    return note?.contentLoaded === false
  })

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!noteId) return
    if (!isShell) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        await ensureNoteBodyLoaded(noteId)
      } catch (err) {
        // Encrypted vault locked — prompt the user to unlock so the body can
        // load. Other errors fall through silently; the background fill / a
        // re-open will retry.
        if (err instanceof VaultLockedError) {
          useUIStore.getState().openModal({ type: 'vault-encryption', data: { mode: 'unlock' } })
        }
      } finally {
        // The `isShell` selector flips to false once the body lands, which
        // re-runs this effect and clears `loading` via the early return above.
        // Clear here too in case the fetch failed (note stayed a shell) so we
        // don't spin a permanent spinner — the hint disappears, the (empty)
        // shell body shows, and a later fill fixes it.
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [noteId, isShell])

  // Show the hint while the body is genuinely still a shell AND a load is in
  // flight (or just kicked off). Once contentLoaded flips, isShell is false.
  return isShell && loading
}
