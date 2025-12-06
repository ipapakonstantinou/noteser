import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Folder } from '@/types'

interface FolderState {
  folders: Folder[]
  activeFolderId: string | null
  expandedFolders: Record<string, boolean>

  // Actions
  addFolder: (folder?: Partial<Folder>) => Folder
  updateFolder: (id: string, updates: Partial<Folder>) => void
  deleteFolder: (id: string) => void
  permanentlyDeleteFolder: (id: string) => void
  restoreFolder: (id: string) => void
  setActiveFolder: (id: string | null) => void
  toggleFolderExpanded: (id: string) => void
  reorderFolders: (folders: Folder[]) => void

  // Getters
  getFolderById: (id: string) => Folder | undefined
  getActiveFolders: () => Folder[]
  getDeletedFolders: () => Folder[]
  getRootFolders: () => Folder[]
  getChildFolders: (parentId: string) => Folder[]
}

export const useFolderStore = create<FolderState>()(
  persist(
    (set, get) => ({
      folders: [],
      activeFolderId: null,
      expandedFolders: {},

      addFolder: (folderData = {}) => {
        const now = Date.now()
        const folders = get().folders
        const maxOrder = folders.length > 0
          ? Math.max(...folders.map(f => f.order))
          : -1

        const newFolder: Folder = {
          id: uuidv4(),
          name: 'New Folder',
          parentId: null,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
          deletedAt: null,
          order: maxOrder + 1,
          ...folderData
        }

        set(state => ({
          folders: [...state.folders, newFolder],
          activeFolderId: newFolder.id,
          expandedFolders: {
            ...state.expandedFolders,
            [newFolder.id]: true
          }
        }))

        return newFolder
      },

      updateFolder: (id, updates) => {
        set(state => ({
          folders: state.folders.map(folder =>
            folder.id === id
              ? { ...folder, ...updates, updatedAt: Date.now() }
              : folder
          )
        }))
      },

      deleteFolder: (id) => {
        set(state => ({
          folders: state.folders.map(folder =>
            folder.id === id
              ? { ...folder, isDeleted: true, deletedAt: Date.now() }
              : folder
          ),
          activeFolderId: state.activeFolderId === id ? null : state.activeFolderId
        }))
      },

      permanentlyDeleteFolder: (id) => {
        set(state => ({
          folders: state.folders.filter(folder => folder.id !== id),
          activeFolderId: state.activeFolderId === id ? null : state.activeFolderId
        }))
      },

      restoreFolder: (id) => {
        set(state => ({
          folders: state.folders.map(folder =>
            folder.id === id
              ? { ...folder, isDeleted: false, deletedAt: null }
              : folder
          )
        }))
      },

      setActiveFolder: (id) => {
        set({ activeFolderId: id })
      },

      toggleFolderExpanded: (id) => {
        set(state => ({
          expandedFolders: {
            ...state.expandedFolders,
            [id]: !state.expandedFolders[id]
          }
        }))
      },

      reorderFolders: (folders) => {
        set({ folders })
      },

      // Getters
      getFolderById: (id) => get().folders.find(folder => folder.id === id),

      getActiveFolders: () =>
        get().folders
          .filter(folder => !folder.isDeleted)
          .sort((a, b) => a.order - b.order),

      getDeletedFolders: () => get().folders.filter(folder => folder.isDeleted),

      getRootFolders: () =>
        get().folders
          .filter(folder => !folder.isDeleted && !folder.parentId)
          .sort((a, b) => a.order - b.order),

      getChildFolders: (parentId) =>
        get().folders
          .filter(folder => !folder.isDeleted && folder.parentId === parentId)
          .sort((a, b) => a.order - b.order)
    }),
    {
      name: 'noteser-folders',
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as FolderState
        if (version === 0 || version === 1) {
          return {
            ...state,
            folders: (state.folders || []).map((folder: Folder & { id?: string | number }) => ({
              ...folder,
              id: String(folder.id),
              parentId: folder.parentId ? String(folder.parentId) : null,
              createdAt: folder.createdAt || Date.now(),
              updatedAt: folder.updatedAt || Date.now(),
              isDeleted: folder.isDeleted || false,
              deletedAt: folder.deletedAt || null,
              order: folder.order ?? 0
            })),
            activeFolderId: state.activeFolderId ? String(state.activeFolderId) : null
          }
        }
        return state
      }
    }
  )
)
