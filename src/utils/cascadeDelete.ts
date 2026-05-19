// Cascade folder deletion: when a folder is soft-deleted, also tombstone
// every attachment under its repo path so the next sync push removes the
// remote copies, and soft-delete every descendant folder.
//
// Without this, deleting (say) the `attachments/` folder leaves the
// individual attachments alive in IDB; the next sync push keeps them on
// the remote, pull re-derives "attachments" as a needed folder, and the
// folder reappears on the next round-trip. See bug u4e5.
//
// Notes inside any of the deleted folders keep the existing
// "move-to-root" behaviour the DeleteConfirmModal already implements —
// this util doesn't touch them.

import type { Folder } from '@/types'
import { useFolderStore } from '@/stores/folderStore'
import { useNoteStore } from '@/stores/noteStore'
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

  // Soft-delete the folder + its descendants. folderStore.deleteFolder
  // already handles activeFolderId nullification when the active one is
  // among them.
  const { deleteFolder } = useFolderStore.getState()
  for (const id of ids) deleteFolder(id)

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

  // Notes inside the deleted folder hierarchy keep their content but
  // move to root (Trash-only flow doesn't make sense for "move to
  // trash"). Matches the existing single-folder delete behaviour, just
  // extended to the whole subtree.
  const { notes, updateNote } = useNoteStore.getState()
  const idSet = new Set(ids)
  for (const note of notes) {
    if (note.isDeleted) continue
    if (note.folderId && idSet.has(note.folderId)) {
      updateNote(note.id, { folderId: null })
    }
  }
}
