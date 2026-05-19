/**
 * revealNote.ts
 *
 * Reveals a note in the sidebar folder tree. Used when a user clicks a
 * note from a non-tree view (Recent, Tags, Backlinks, etc.) so they can
 * see where the note lives without having to manually switch views and
 * expand folders.
 *
 * Steps:
 *   1. Look up the note (bail if missing or soft-deleted).
 *   2. Walk up the note's folder hierarchy, expanding every ancestor.
 *   3. Switch the current view to 'notes'.
 *   4. After paint, scroll the row into view and flash it briefly.
 *
 * Notes at the root (no folderId) have no ancestors to expand, but we
 * still switch the view, scroll, and flash so the behaviour is uniform.
 */
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useUIStore } from '@/stores/uiStore'

// Public so tests / callers can adjust if needed. ~800ms matches a
// quick attention-grab without being annoying.
export const REVEAL_FLASH_MS = 800
export const REVEAL_FLASH_CLASS = 'is-revealed-flash'

export function revealNote(noteId: string): void {
  const note = useNoteStore.getState().getNoteById(noteId)
  if (!note || note.isDeleted) return

  // 1. Expand every ancestor folder so the row will be visible.
  const folderStore = useFolderStore.getState()
  const folderById = new Map(folderStore.folders.map(f => [f.id, f]))
  let currentId: string | null = note.folderId
  // Guard against pathological cycles in folder data (shouldn't happen,
  // but cheap to defend).
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const folder = folderById.get(currentId)
    if (!folder || folder.isDeleted) break
    folderStore.setFolderExpanded(currentId, true)
    currentId = folder.parentId
  }

  // 2. Switch view so the tree is rendering.
  useUIStore.getState().setCurrentView('notes')

  // 3. Scroll + flash after the view has had a chance to render. We
  // need two RAFs because switching the view triggers a state update
  // that React batches into the next frame.
  if (typeof window === 'undefined') return
  const scrollAndFlash = () => {
    const el = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)
    if (!el) return
    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest' })
      } catch {
        // Very old browsers can throw on the options arg — retry
        // with the boolean form.
        try { el.scrollIntoView() } catch { /* swallow */ }
      }
    }
    el.classList.add(REVEAL_FLASH_CLASS)
    window.setTimeout(() => {
      el.classList.remove(REVEAL_FLASH_CLASS)
    }, REVEAL_FLASH_MS)
  }
  // Two-frame defer so React has time to re-render the tree after
  // setCurrentView('notes'). Falls back to setTimeout(0) for envs
  // without requestAnimationFrame (e.g. jsdom in some configs).
  const raf = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
  raf(() => raf(scrollAndFlash))
}
