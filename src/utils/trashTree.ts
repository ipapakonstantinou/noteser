// Reconstructs the hierarchy of soft-deleted notes + folders for the
// synthetic ".trash" sidebar view.
//
// Soft-delete writes nothing special: a cascade-deleted folder tombstones
// BOTH the folder (isDeleted:true) and its notes (isDeleted:true), each
// keeping its original parentId / folderId. That means the pre-deletion
// shape is still fully recoverable from the data — we only need to
// reassemble it for display. This module does exactly that, READ-ONLY:
// it never mutates store state.
//
// Rules (mirroring where things lived before deletion):
//   - A deleted note whose folderId points to a *deleted* folder nests
//     inside that folder.
//   - A deleted note whose folderId is null, OR points to a folder that
//     is NOT deleted (or no longer exists), is "loose" and sits directly
//     under .trash — restoring it lands it back where it still belongs.
//   - A deleted folder nests under its parent folder when that parent is
//     ALSO deleted; otherwise it surfaces at the trash root.
//   - Deleted folders that contain no deleted notes anywhere in their
//     subtree are pruned — an empty tombstoned shell would just be noise.
//
// The result is a list of TrashNode trees plus the flat set of loose
// notes, ready for the renderer to walk.

import type { Folder, Note } from '@/types'

export interface TrashFolderNode {
  kind: 'folder'
  folder: Folder
  /** Child folder nodes (recursively), already pruned of empties. */
  childFolders: TrashFolderNode[]
  /** Deleted notes that lived directly in this folder. */
  notes: Note[]
}

export interface TrashTree {
  /** Deleted folders that surface at the trash root (their parent is not
   *  itself deleted), each carrying its deleted descendants. */
  rootFolders: TrashFolderNode[]
  /** Deleted notes that have no deleted parent folder — shown flat at the
   *  trash root, exactly like the old behaviour. */
  looseNotes: Note[]
}

// Build the reconstructed trash tree from the soft-deleted entities.
//
// `deletedFolders` / `deletedNotes` are the already-filtered sets
// (isDeleted === true). Passing them in (rather than the full arrays)
// keeps this pure + cheap to memoise on the caller side.
export function buildTrashTree(
  deletedNotes: Note[],
  deletedFolders: Folder[],
): TrashTree {
  const deletedFolderById = new Map(deletedFolders.map(f => [f.id, f]))

  // Bucket deleted notes by their folderId. A note whose folderId is null
  // or points to a folder that is NOT in the deleted set is "loose".
  const notesByDeletedFolder = new Map<string, Note[]>()
  const looseNotes: Note[] = []
  for (const note of deletedNotes) {
    if (note.folderId && deletedFolderById.has(note.folderId)) {
      const arr = notesByDeletedFolder.get(note.folderId)
      if (arr) arr.push(note)
      else notesByDeletedFolder.set(note.folderId, [note])
    } else {
      looseNotes.push(note)
    }
  }

  // Bucket deleted child folders by their deleted parent. A deleted folder
  // whose parent is NOT deleted is a root within the trash tree.
  const childFoldersByDeletedParent = new Map<string, Folder[]>()
  const rootDeletedFolders: Folder[] = []
  for (const folder of deletedFolders) {
    if (folder.parentId && deletedFolderById.has(folder.parentId)) {
      const arr = childFoldersByDeletedParent.get(folder.parentId)
      if (arr) arr.push(folder)
      else childFoldersByDeletedParent.set(folder.parentId, [folder])
    } else {
      rootDeletedFolders.push(folder)
    }
  }

  const sortByName = (a: Folder, b: Folder): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  // Recursively build a node, returning null when the folder + its whole
  // subtree hold no deleted notes (so empty tombstoned shells are pruned).
  // A depth guard mirrors the rest of the codebase's cycle protection.
  const build = (folder: Folder, depth: number): TrashFolderNode | null => {
    if (depth > 32) return null
    const childFolders = (childFoldersByDeletedParent.get(folder.id) ?? [])
      .slice()
      .sort(sortByName)
      .map(child => build(child, depth + 1))
      .filter((n): n is TrashFolderNode => n !== null)

    const notes = notesByDeletedFolder.get(folder.id) ?? []

    if (childFolders.length === 0 && notes.length === 0) return null
    return { kind: 'folder', folder, childFolders, notes }
  }

  const rootFolders = rootDeletedFolders
    .slice()
    .sort(sortByName)
    .map(folder => build(folder, 0))
    .filter((n): n is TrashFolderNode => n !== null)

  return { rootFolders, looseNotes }
}

// Collect every folder id in a trash subtree (the node + descendants).
// Used by folder-level trash actions (restore / permanent delete) so they
// can operate on the whole reconstructed subtree, not just the top folder.
export function collectTrashFolderIds(node: TrashFolderNode): string[] {
  const out: string[] = [node.folder.id]
  for (const child of node.childFolders) out.push(...collectTrashFolderIds(child))
  return out
}

// Collect every note id in a trash subtree (the node + descendants).
export function collectTrashNoteIds(node: TrashFolderNode): string[] {
  const out: string[] = node.notes.map(n => n.id)
  for (const child of node.childFolders) out.push(...collectTrashNoteIds(child))
  return out
}
