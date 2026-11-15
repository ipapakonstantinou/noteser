import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageJSON } from '@/utils/persistStorage'

// Per-note "collaboration is active" state for the `per-note` collaboration
// mode. PERSISTED per-DEVICE (2026-06-15): a note the user turned live STAYS
// live across a page reload, matching the mental model that "Go live" is a
// durable per-note choice, not a session-only blip. A note is "active" because
// the user explicitly turned it on (the EditorFooter / sidebar "Go live"
// toggle) or because they arrived via a `?collab=…` share link.
//
// Persistence shape: the in-memory state holds the active ids as a Set (cheap
// membership tests, no stale-key accumulation). The persist layer serializes
// that Set to a string[] on write and rehydrates it back into a Set on read
// (JSON has no Set type), so the on-disk format stays a plain array.
//
// RELOAD / anti-doubling note: on reload with a note already active and
// collaborationMode === 'per-note', the editor sees getCollabUrlForNote()
// non-null on its FIRST mount and connects immediately. CodeMirrorEditor
// builds the editor EMPTY in that case (editorInitialValue = '' when
// collabEnabled) and the collab effect additionally clears any residual doc
// before attaching the yjs binding, so the persisted local content and the
// yjs sync do NOT double the text. See collabNoDoubling + activeCollabStore
// tests.
//
// In `repo` mode this store is bypassed (every note is treated as active); in
// `off` mode it is ignored entirely. It only gates the connection in the
// `per-note` mode — see getCollabUrlForNote() in useCollaboration.ts.
interface ActiveCollabState {
  // Set of note ids with collaboration explicitly activated.
  activeNoteIds: Set<string>
  isActive: (noteId: string) => boolean
  // Turn collab on for a note (EditorFooter / context-menu toggle, share-link).
  activate: (noteId: string) => void
  // Turn collab back off for a note. "Stop live" goes through stopLiveCollab.
  deactivate: (noteId: string) => void
  // Room ids this device saw end (its own Stop, or the server's 4410). Never
  // joined again: ensureCollabId mints a new id instead.
  endedRooms: string[]
  endRoom: (room: string) => void
}

// ponytail: keeps the last 200; an older ended id could be rejoined (it is an empty room by then).
const MAX_ENDED_ROOMS = 200

export const useActiveCollabStore = create<ActiveCollabState>()(
  persist(
    (set, get) => ({
      activeNoteIds: new Set<string>(),
      isActive: (noteId) => get().activeNoteIds.has(noteId),
      activate: (noteId) =>
        set((state) =>
          state.activeNoteIds.has(noteId)
            ? state
            : { activeNoteIds: new Set(state.activeNoteIds).add(noteId) },
        ),
      deactivate: (noteId) =>
        set((state) => {
          if (!state.activeNoteIds.has(noteId)) return state
          const next = new Set(state.activeNoteIds)
          next.delete(noteId)
          return { activeNoteIds: next }
        }),
      endedRooms: [],
      endRoom: (room) =>
        set((state) =>
          state.endedRooms.includes(room)
            ? state
            : { endedRooms: [...state.endedRooms, room].slice(-MAX_ENDED_ROOMS) },
        ),
    }),
    {
      name: 'noteser-active-collab',
      storage: localStorageJSON,
      // JSON can't represent a Set: persist the active ids as a plain string[]
      // and rehydrate them back into a Set. partialize controls what is
      // written (only the ids); merge reconstructs the Set on read since the
      // serialized form is an array.
      partialize: (state) => ({
        activeNoteIds: Array.from(state.activeNoteIds),
        endedRooms: state.endedRooms,
      }),
      merge: (persisted, current) => {
        const p = persisted as { activeNoteIds?: unknown; endedRooms?: unknown } | undefined
        const strings = (raw: unknown) =>
          Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
        return { ...current, activeNoteIds: new Set(strings(p?.activeNoteIds)), endedRooms: strings(p?.endedRooms) }
      },
    },
  ),
)
