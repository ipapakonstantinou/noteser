import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Note, Template, DEFAULT_TEMPLATES } from '@/types'
import { idbStorage } from '@/utils/idbStorage'
import {
  softDelete,
  restoreSoftDeleted,
  permanentlyDelete,
  emptyTrash as emptyTrashItems,
} from '@/utils/softDelete'
import { STORAGE_KEYS } from '@/utils/storageKeys'
import { useSettingsStore } from '@/stores/settingsStore'

// Module-scoped memoisation for the active / deleted getters. Keyed by
// the `notes` ARRAY IDENTITY — Zustand's set() always replaces the
// array on mutation, so reference equality is a perfect cache key.
// At 5k notes this turns a re-filter into a single object compare on
// every selector read that didn't trigger a store update.
let cachedActive: { notes: Note[]; result: Note[] } = { notes: [], result: [] }
let cachedDeleted: { notes: Note[]; result: Note[] } = { notes: [], result: [] }

interface NoteState {
  notes: Note[]
  selectedNoteId: string | null

  // Actions
  addNote: (note?: Partial<Note>) => Note
  updateNote: (id: string, updates: Partial<Note>) => void
  deleteNote: (id: string) => void
  /** Bulk delete — single setState write. Same trash-mode rules as
   *  deleteNote (soft by default, hard when settings say so). */
  deleteNotes: (ids: string[]) => void
  permanentlyDeleteNote: (id: string) => void
  restoreNote: (id: string) => void
  selectNote: (id: string | null) => void
  duplicateNote: (id: string) => Note | null
  moveNoteToFolder: (noteId: string, folderId: string | null) => void
  togglePinNote: (id: string) => void
  emptyTrash: () => void
  createFromTemplate: (template: Template, folderId?: string | null) => Note
  /** Lazily assign + return a stable collab room id for a note. Returns
   *  the existing id if one is already set (idempotent). Used by the
   *  live-collaboration binding to name the y-websocket room. No-op-ish
   *  when collab is disabled (callers only invoke it on the collab path),
   *  so single-user/default behaviour never generates one. */
  ensureCollabId: (id: string) => string | null

  // Getters
  getNoteById: (id: string) => Note | undefined
  getActiveNotes: () => Note[]
  getDeletedNotes: () => Note[]
  getNotesByFolder: (folderId: string | null) => Note[]
  getNotesByTag: (tagId: string) => Note[]
  getPinnedNotes: () => Note[]
  getRecentNotes: (limit?: number) => Note[]
}

export const useNoteStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      selectedNoteId: null,

      addNote: (noteData = {}) => {
        const now = Date.now()
        const newNote: Note = {
          id: uuidv4(),
          title: 'Untitled Note',
          content: '',
          folderId: null,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
          deletedAt: null,
          isPinned: false,
          templateId: null,
          ...noteData
        }

        set(state => ({
          notes: [...state.notes, newNote],
          selectedNoteId: newNote.id
        }))

        return newNote
      },

      updateNote: (id, updates) => {
        set(state => ({
          notes: state.notes.map(note =>
            note.id === id
              ? { ...note, ...updates, updatedAt: Date.now() }
              : note
          )
        }))
      },

      deleteNote: (id) => {
        // Respect the user's trash-mode setting: 'trash' (default) keeps
        // the soft-delete behaviour so the note shows in the Trash view
        // and can be restored; 'hardDelete' removes it immediately.
        const trashMode = useSettingsStore.getState().trashMode
        if (trashMode === 'hardDelete') {
          set(state => ({
            notes: permanentlyDelete(state.notes, id),
            selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
          }))
          return
        }
        set(state => ({
          notes: softDelete(state.notes, id),
          selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
        }))
      },

      // Bulk delete — single set() so we don't hit the same O(N²) IDB
      // write storm that bit applyNonConflicts before its batched fix.
      // Same trash-mode rules as deleteNote.
      deleteNotes: (ids) => {
        if (ids.length === 0) return
        const idSet = new Set(ids)
        const trashMode = useSettingsStore.getState().trashMode
        const now = Date.now()
        set(state => {
          let notes = state.notes
          if (trashMode === 'hardDelete') {
            notes = notes.filter(n => !idSet.has(n.id))
          } else {
            notes = notes.map(n => idSet.has(n.id)
              ? { ...n, isDeleted: true, deletedAt: now }
              : n)
          }
          const selectedNoteId = state.selectedNoteId != null && idSet.has(state.selectedNoteId)
            ? null
            : state.selectedNoteId
          return { notes, selectedNoteId }
        })
      },

      permanentlyDeleteNote: (id) => {
        set(state => ({
          notes: permanentlyDelete(state.notes, id),
          selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
        }))
      },

      restoreNote: (id) => {
        set(state => ({
          notes: restoreSoftDeleted(state.notes, id),
        }))
      },

      selectNote: (id) => {
        set({ selectedNoteId: id })
      },

      duplicateNote: (id) => {
        const note = get().notes.find(n => n.id === id)
        if (!note) return null

        const now = Date.now()
        const duplicatedNote: Note = {
          ...note,
          id: uuidv4(),
          title: `${note.title} (Copy)`,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
          deletedAt: null,
          isPinned: false
        }

        set(state => ({
          notes: [...state.notes, duplicatedNote],
          selectedNoteId: duplicatedNote.id
        }))

        return duplicatedNote
      },

      moveNoteToFolder: (noteId, folderId) => {
        set(state => ({
          notes: state.notes.map(note =>
            note.id === noteId
              ? { ...note, folderId, updatedAt: Date.now() }
              : note
          )
        }))
      },

      togglePinNote: (id) => {
        set(state => ({
          notes: state.notes.map(note =>
            note.id === id
              ? { ...note, isPinned: !note.isPinned, updatedAt: Date.now() }
              : note
          )
        }))
      },

      emptyTrash: () => {
        set(state => ({ notes: emptyTrashItems(state.notes) }))
      },

      createFromTemplate: (template, folderId = null) => {
        const now = Date.now()
        const newNote: Note = {
          id: uuidv4(),
          title: template.name,
          content: template.content,
          folderId,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
          deletedAt: null,
          isPinned: false,
          templateId: template.id
        }

        set(state => ({
          notes: [...state.notes, newNote],
          selectedNoteId: newNote.id
        }))

        return newNote
      },

      ensureCollabId: (id) => {
        const note = get().notes.find(n => n.id === id)
        if (!note) return null
        if (note.collabId) return note.collabId
        const collabId = uuidv4()
        set(state => ({
          notes: state.notes.map(n =>
            n.id === id ? { ...n, collabId } : n
          ),
        }))
        return collabId
      },

      // Getters. Memoised by `notes` array IDENTITY — Zustand replaces
      // the array on every mutation, so we trust ref equality. Saves a
      // 5k-element re-filter on every render that calls these helpers.
      getNoteById: (id) => get().notes.find(note => note.id === id),

      getActiveNotes: () => {
        const notes = get().notes
        if (cachedActive.notes === notes) return cachedActive.result
        const result = notes.filter(note => !note.isDeleted)
        cachedActive = { notes, result }
        return result
      },

      getDeletedNotes: () => {
        const notes = get().notes
        if (cachedDeleted.notes === notes) return cachedDeleted.result
        const result = notes.filter(note => note.isDeleted)
        cachedDeleted = { notes, result }
        return result
      },

      getNotesByFolder: (folderId) =>
        get().notes.filter(note => !note.isDeleted && note.folderId === folderId),

      // Tags are derived from `#word` patterns in body content now; legacy
      // callers can still ask "which notes contain this tag name".
      getNotesByTag: (tagName) =>
        get().notes.filter(note => {
          if (note.isDeleted) return false
          const lc = tagName.toLowerCase()
          return new RegExp(`(^|[^\\w#/-])#${lc.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![\\w/-])`, 'i').test(note.content)
        }),

      getPinnedNotes: () =>
        get().notes.filter(note => !note.isDeleted && note.isPinned),

      getRecentNotes: (limit = 5) =>
        get()
          .notes
          .filter(note => !note.isDeleted)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
    }),
    {
      name: STORAGE_KEYS.notes,
      storage: idbStorage,
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as NoteState
        if (version === 0 || version === 1) {
          // Migrate from old format
          return {
            ...state,
            notes: (state.notes || []).map((note: Note & { id?: string | number }) => ({
              ...note,
              id: String(note.id),
              createdAt: note.createdAt || Date.now(),
              updatedAt: note.updatedAt || Date.now(),
              isDeleted: note.isDeleted || false,
              deletedAt: note.deletedAt || null,
              isPinned: note.isPinned || false,
              templateId: note.templateId || null,
              folderId: note.folderId ? String(note.folderId) : null
            }))
          }
        }
        return state
      }
    }
  )
)
