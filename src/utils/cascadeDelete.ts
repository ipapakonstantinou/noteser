// Cascade folder deletion: when a folder is soft-deleted, also tombstone
// every attachment under its repo path so the next sync push removes the
// remote copies, and soft-delete every descendant folder.
//
// Without this, deleting (say) the `attachments/` folder leaves the
// individual attachments alive in IDB; the next sync push keeps them on
// the remote, pull re-derives "attachments" as a needed folder, and the
// folder reappears on the next round-trip. See bug u4e5.
//
// Notes inside the deleted folder hierarchy are themselves soft-deleted
// (or hard-deleted in trashMode='hardDelete'). Earlier behaviour moved
// them to root, which surprised users — they expected "delete folder"
// to remove the folder AND its contents, the same way most file
// managers do. See bug report 2026-05-20.

import type { Folder } from '@/types'
import { useFolderStore } from '@/stores/folderStore'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { listAttachmentMeta, deleteAttachment } from './attachments'

// Build the repo path for a folder (e.g. "Notes/Daily"). Walks up to the
// root, guarding against cycles with a depth cap.
function folderRepoPath(folderId: string, folders: Folder[]): string {
  const byId = new Map(folders.map(f => [f.id, f]))
  const segs: string[] = []
  let cur = byId.get(folderId)
  for (let i = 0; cur && i < 32; i++) {
    if (cur.isDeleted) break
    segs.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return segs.join('/')
}

// Every non-deleted descendant id (including the folder itself).
function descendantFolderIds(folderId: string, folders: Folder[]): string[] {
  const out: string[] = []
  const queue: string[] = [folderId]
  while (queue.length > 0) {
    const id = queue.shift()!
    out.push(id)
    for (const f of folders) {
      if (!f.isDeleted && f.parentId === id) queue.push(f.id)
    }
  }
  return out
}

// Soft-delete `folderId`, every descendant folder, and tombstone all
// attachments whose path is inside any of those folders. The IDB cleanup
// is async (it queries listAttachmentMeta) but fire-and-forget — the
// sidebar updates via `noteser:attachments-changed`.
export function cascadeDeleteFolder(folderId: string): void {
  const folders = useFolderStore.getState().folders
  const root = folders.find(f => f.id === folderId)
  if (!root || root.isDeleted) return

  const rootPath = folderRepoPath(folderId, folders)
  const ids = descendantFolderIds(folderId, folders)
  const idSet = new Set(ids)

  // Tombstone the repo paths of every deleted folder. The pull layer
  // checks this list before emitting folderCreated so a hidden folder
  // whose remote contents aren't noteser-managed (e.g. `.obsidian/`
  // with config.json + plugins/) doesn't reappear on the next sync.
  // Without this the dir-walk in pullFromGitHub step 1b would see the
  // non-md files and re-derive the folder. See bug "delete hidden
  // folder and sync again it doesn't work."
  const tombstone = useFolderStore.getState().addDeletedFolderPath
  for (const id of ids) {
    const p = folderRepoPath(id, folders)
    if (p) tombstone(p)
  }

  // Soft-delete the folder + its descendants in a SINGLE setState. Before
  // batching, deleting a folder with ~600 notes/descendants ran
  // folderStore.deleteFolder N times, each mapping the full folders
  // array — O(N²) work + N renders that froze the UI.
  const now = Date.now()
  useFolderStore.setState(state => ({
    folders: state.folders.map(f =>
      idSet.has(f.id) && !f.isDeleted
        ? { ...f, isDeleted: true, deletedAt: now, updatedAt: now }
        : f
    ),
    activeFolderId:
      state.activeFolderId != null && idSet.has(state.activeFolderId)
        ? null
        : state.activeFolderId,
  }))

  // Tombstone the attachments asynchronously. listAttachmentMeta hits
  // IDB; we can't await inside this synchronous action without bleeding
  // a promise out — and the modal that calls this just closes after the
  // call, so user-visible feedback already lives in the
  // `noteser:attachments-changed` listener.
  void (async () => {
    if (!rootPath) return
    const meta = await listAttachmentMeta()
    for (const m of meta) {
      // Match attachments whose path is exactly inside the deleted
      // folder tree. We allow `${rootPath}/` plus deeper nesting.
      if (m.path === rootPath || m.path.startsWith(`${rootPath}/`)) {
        // deleteAttachment already adds a tombstone so the next push
        // removes the remote copy.
        await deleteAttachment(m.path)
      }
    }
  })()

  // Notes inside the deleted folder hierarchy are removed too — same
  // batched setState pattern as the folder write above so large folders
  // don't freeze the UI. Hard-delete mode prunes them outright; trash
  // mode soft-deletes (sets isDeleted=true, deletedAt=now) so the user
  // can still recover individual notes from the trash if needed.
  const trashMode = useSettingsStore.getState().trashMode
  useNoteStore.setState(state => {
    if (trashMode === 'hardDelete') {
      return {
        notes: state.notes.filter(n => !(n.folderId && idSet.has(n.folderId) && !n.isDeleted)),
      }
    }
    return {
      notes: state.notes.map(n =>
        !n.isDeleted && n.folderId && idSet.has(n.folderId)
          ? { ...n, isDeleted: true, deletedAt: now, updatedAt: now }
          : n
      ),
    }
  })
}
