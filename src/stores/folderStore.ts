import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Folder } from '@/types'
import { idbStorage } from '@/utils/idbStorage'
import { sanitizeFilename } from '@/utils/export'
import { softDelete, restoreSoftDeleted, permanentlyDelete } from '@/utils/softDelete'
import { STORAGE_KEYS } from '@/utils/storageKeys'
// folderStore doesn't read settings directly today — the trash-mode
// dispatch lives in DeleteConfirmModal so the folder deletion path can
// pick between cascadeDeleteFolder (soft) and permanentlyDeleteFolder.

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
  setFolderExpanded: (id: string, expanded: boolean) => void
  setAllFoldersExpanded: (expanded: boolean) => void
  reorderFolders: (folders: Folder[]) => void
  // Walks a repo path (e.g. ["images"]) creating any missing folder
  // segments. Idempotent: existing folders match by sanitized name +
  // parent. Returns the leaf folder id, or null for an empty path.
  ensureFolderPath: (segments: string[]) => string | null

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
          folders: softDelete(state.folders, id),
          activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
        }))
      },

      permanentlyDeleteFolder: (id) => {
        set(state => ({
          folders: permanentlyDelete(state.folders, id),
          activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
        }))
      },

      restoreFolder: (id) => {
        set(state => ({
          folders: restoreSoftDeleted(state.folders, id),
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

      // Directly set a folder's expanded flag. Distinct from toggle so
      // callers (e.g. revealNote walking up ancestors) can ensure a
      // folder is expanded without flipping an already-expanded one.
      setFolderExpanded: (id, expanded) => {
        set(state => {
          if (!!state.expandedFolders[id] === expanded) return state
          return {
            expandedFolders: {
              ...state.expandedFolders,
              [id]: expanded
            }
          }
        })
      },

      // Bulk action used by the folder-tree toolbar. Expanded = true sets
      // every non-deleted folder to expanded; false collapses everything.
      setAllFoldersExpanded: (expanded) => {
        set(state => {
          const next: Record<string, boolean> = {}
          for (const f of state.folders) {
            if (f.isDeleted) continue
            next[f.id] = expanded
          }
          return { expandedFolders: next }
        })
      },

      reorderFolders: (folders) => {
        set({ folders })
      },

      ensureFolderPath: (segments) => {
        if (segments.length === 0) return null
        let parentId: string | null = null
        for (const segment of segments) {
          const desired = sanitizeFilename(segment)
          const existing = get().folders.find(
            f => !f.isDeleted
              && (f.parentId ?? null) === parentId
              && sanitizeFilename(f.name) === desired,
          )
          if (existing) {
            parentId = existing.id
            continue
          }
          // Call the store's own addFolder so order/timestamps stay consistent.
          const created = get().addFolder({ name: segment, parentId })
          parentId = created.id
        }
        return parentId
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
      name: STORAGE_KEYS.folders,
      storage: idbStorage,
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
