import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Folder } from '@/types'
import { idbStorage } from '@/utils/idbStorage'
import { sanitizeFilename } from '@/utils/sanitizeFilename'
import { softDelete, restoreSoftDeleted, permanentlyDelete } from '@/utils/softDelete'
import { STORAGE_KEYS } from '@/utils/storageKeys'
// folderStore doesn't read settings directly today — the trash-mode
// dispatch lives in DeleteConfirmModal so the folder deletion path can
// pick between cascadeDeleteFolder (soft) and permanentlyDeleteFolder.

interface FolderState {
  folders: Folder[]
  activeFolderId: string | null
  expandedFolders: Record<string, boolean>
  // Repo paths the user explicitly deleted. The pull layer skips
  // folder-derivation for any directory whose path is in here (or
  // nested inside a tombstoned dir), so a hidden folder like
  // `.obsidian/` doesn't reappear next pull just because its
  // non-noteser-managed files still exist remotely. Cleared when the
  // user re-creates a folder that resolves to the same repo path.
  deletedFolderPaths: string[]

  // Actions
  addFolder: (folder?: Partial<Folder>) => Folder
  updateFolder: (id: string, updates: Partial<Folder>) => void
  deleteFolder: (id: string) => void
  addDeletedFolderPath: (path: string) => void
  removeDeletedFolderPath: (path: string) => void
  permanentlyDeleteFolder: (id: string) => void
  restoreFolder: (id: string) => void
  /** Bulk restore — un-deletes every matching folder id in one setState
   *  and drops each restored folder's repo path from deletedFolderPaths.
   *  Used by the trash view when restoring a deleted folder SUBTREE (the
   *  folder plus its deleted descendant folders, recursively). */
  restoreFolders: (ids: string[]) => void
  /** Bulk permanent delete — drops every matching folder id in one
   *  setState. Used when permanently deleting a trashed folder subtree. */
  permanentlyDeleteFolders: (ids: string[]) => void
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
      deletedFolderPaths: [],

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

      addDeletedFolderPath: (path) => {
        if (!path) return
        set(state => state.deletedFolderPaths.includes(path)
          ? state
          : { deletedFolderPaths: [...state.deletedFolderPaths, path] })
      },

      removeDeletedFolderPath: (path) => {
        if (!path) return
        set(state => state.deletedFolderPaths.includes(path)
          ? { deletedFolderPaths: state.deletedFolderPaths.filter(p => p !== path) }
          : state)
      },

      permanentlyDeleteFolder: (id) => {
        set(state => ({
          folders: permanentlyDelete(state.folders, id),
          activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
        }))
      },

      restoreFolder: (id) => {
        set(state => {
          const restored = restoreSoftDeleted(state.folders, id)
          // Drop the tombstone for this folder's path (if any) so the
          // next pull re-derives any remote children. We compute the
          // path from the freshly-restored folders array so ancestors
          // that are still trashed don't truncate the result.
          const f = restored.find(x => x.id === id)
          if (!f) return { folders: restored }
          // Walk up using the restored array.
          const byId = new Map(restored.map(x => [x.id, x]))
          const segs: string[] = []
          let cur = f
          for (let i = 0; cur && i < 32; i++) {
            if (cur.isDeleted) break
            segs.unshift(sanitizeFilename(cur.name))
            const p: string | null = cur.parentId ?? null
            cur = p ? byId.get(p)! : undefined as unknown as Folder
          }
          const path = segs.join('/')
          const deletedFolderPaths = path
            ? state.deletedFolderPaths.filter(p => p !== path)
            : state.deletedFolderPaths
          return { folders: restored, deletedFolderPaths }
        })
      },

      restoreFolders: (ids) => {
        if (ids.length === 0) return
        const idSet = new Set(ids)
        set(state => {
          // Un-delete the whole set in one pass so a child folder's path
          // computation sees its (also-restored) ancestors as active.
          const restored = state.folders.map(f =>
            idSet.has(f.id) && f.isDeleted
              ? { ...f, isDeleted: false, deletedAt: null }
              : f
          )
          // Drop the tombstone path of every restored folder. Paths are
          // computed from the restored array so freshly-revived ancestors
          // don't truncate the walk.
          const byId = new Map(restored.map(x => [x.id, x]))
          const pathsToDrop = new Set<string>()
          for (const id of ids) {
            const f = byId.get(id)
            if (!f) continue
            const segs: string[] = []
            let cur: Folder | undefined = f
            for (let i = 0; cur && i < 32; i++) {
              if (cur.isDeleted) break
              segs.unshift(sanitizeFilename(cur.name))
              const p: string | null = cur.parentId ?? null
              cur = p ? byId.get(p) : undefined
            }
            const path = segs.join('/')
            if (path) pathsToDrop.add(path)
          }
          const deletedFolderPaths = pathsToDrop.size > 0
            ? state.deletedFolderPaths.filter(p => !pathsToDrop.has(p))
            : state.deletedFolderPaths
          return { folders: restored, deletedFolderPaths }
        })
      },

      permanentlyDeleteFolders: (ids) => {
        if (ids.length === 0) return
        const idSet = new Set(ids)
        set(state => ({
          folders: state.folders.filter(f => !idSet.has(f.id)),
          activeFolderId: state.activeFolderId != null && idSet.has(state.activeFolderId)
            ? null
            : state.activeFolderId,
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
          // Store the SANITIZED segment as folder.name so that the path we
          // generate on the next push (which sanitizes folder.name again)
          // round-trips to the same path the remote already has. Storing
          // the raw segment caused the "every push uploads every blob"
          // bug: remote has "Daily Notes/foo.md", we'd store name="Daily
          // Notes", push would generate "Daily-Notes/foo.md" (sanitized
          // space→dash) — mismatch → re-upload every cycle.
          const created = get().addFolder({ name: desired, parentId })
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
