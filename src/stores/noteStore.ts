import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Note, Template, DEFAULT_TEMPLATES } from '@/types'

interface NoteState {
  notes: Note[]
  selectedNoteId: string | null

  // Actions
  addNote: (note?: Partial<Note>) => Note
  updateNote: (id: string, updates: Partial<Note>) => void
  deleteNote: (id: string) => void
  permanentlyDeleteNote: (id: string) => void
  restoreNote: (id: string) => void
  selectNote: (id: string | null) => void
  duplicateNote: (id: string) => Note | null
  moveNoteToFolder: (noteId: string, folderId: string | null) => void
  togglePinNote: (id: string) => void
  emptyTrash: () => void
  createFromTemplate: (template: Template, folderId?: string | null) => Note

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
          tags: [],
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
        set(state => ({
          notes: state.notes.map(note =>
            note.id === id
              ? { ...note, isDeleted: true, deletedAt: Date.now() }
              : note
          ),
          selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId
        }))
      },

      permanentlyDeleteNote: (id) => {
        set(state => ({
          notes: state.notes.filter(note => note.id !== id),
          selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId
        }))
      },

      restoreNote: (id) => {
        set(state => ({
          notes: state.notes.map(note =>
            note.id === id
              ? { ...note, isDeleted: false, deletedAt: null }
              : note
          )
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
        set(state => ({
          notes: state.notes.filter(note => !note.isDeleted)
        }))
      },

      createFromTemplate: (template, folderId = null) => {
        const now = Date.now()
        const newNote: Note = {
          id: uuidv4(),
          title: template.name,
          content: template.content,
          folderId,
          tags: [],
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

      // Getters
      getNoteById: (id) => get().notes.find(note => note.id === id),

      getActiveNotes: () => get().notes.filter(note => !note.isDeleted),

      getDeletedNotes: () => get().notes.filter(note => note.isDeleted),

      getNotesByFolder: (folderId) =>
        get().notes.filter(note => !note.isDeleted && note.folderId === folderId),

      getNotesByTag: (tagId) =>
        get().notes.filter(note => !note.isDeleted && note.tags.includes(tagId)),

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
      name: 'noteser-notes',
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
              tags: note.tags || [],
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
