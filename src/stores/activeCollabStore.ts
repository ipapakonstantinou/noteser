import { create } from 'zustand'

// Per-note "collaboration is active" state for the `per-note` collaboration
// mode. EPHEMERAL by design — NOT persisted. A note is "active" only because
// the user explicitly turned it on this session (the EditorFooter "Live"
// toggle) or because they arrived via a `?collab=…` share link. A reload
// starts every note solo again, which is the safe default: collab is opt-in
// per session, so an accidental reload never silently reconnects rooms.
//
// In `repo` mode this store is bypassed (every note is treated as active); in
// `off` mode it is ignored entirely. It only gates the connection in the
// `per-note` mode — see getCollabUrlForNote() in useCollaboration.ts.
interface ActiveCollabState {
  // Set of note ids with collaboration explicitly activated this session.
  activeNoteIds: Record<string, true>
  isActive: (noteId: string) => boolean
  // Turn collab on for a note (EditorFooter toggle / share-link join).
  activate: (noteId: string) => void
  // Turn collab back off for a note.
  deactivate: (noteId: string) => void
  // Flip a note's active state, returning the new state.
  toggle: (noteId: string) => boolean
}

export const useActiveCollabStore = create<ActiveCollabState>((set, get) => ({
  activeNoteIds: {},
  isActive: (noteId) => get().activeNoteIds[noteId] === true,
  activate: (noteId) =>
    set((state) =>
      state.activeNoteIds[noteId]
        ? state
        : { activeNoteIds: { ...state.activeNoteIds, [noteId]: true } },
    ),
  deactivate: (noteId) =>
    set((state) => {
      if (!state.activeNoteIds[noteId]) return state
      const next = { ...state.activeNoteIds }
      delete next[noteId]
      return { activeNoteIds: next }
    }),
  toggle: (noteId) => {
    const nowActive = !get().activeNoteIds[noteId]
    if (nowActive) get().activate(noteId)
    else get().deactivate(noteId)
    return nowActive
  },
}))
