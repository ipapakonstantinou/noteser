// Pure helpers for the soft-delete pattern shared by noteStore and
// folderStore (and any future entity that wants the same trash/restore
// behaviour). Each store still owns its own selection-state side effects
// (clearing selectedNoteId / activeFolderId when the deleted id was
// selected); these helpers handle only the array transforms.
//
// Every helper returns a NEW array; callers pass the result into
// Zustand's `set`. Pure, no time source closed over — pass `now` to the
// soft-delete helper if you need a deterministic timestamp in tests.

export interface SoftDeletable {
  id: string
  isDeleted: boolean
  deletedAt: number | null
}

// Mark the matching item soft-deleted. No-op if the id isn't present.
// Items already deleted have their deletedAt timestamp updated.
export function softDelete<T extends SoftDeletable>(
  items: T[],
  id: string,
  now: number = Date.now(),
): T[] {
  return items.map(it => it.id === id ? { ...it, isDeleted: true, deletedAt: now } : it)
}

// Reverse a soft delete. No-op if the id isn't present or isn't deleted.
export function restoreSoftDeleted<T extends SoftDeletable>(items: T[], id: string): T[] {
  return items.map(it => it.id === id ? { ...it, isDeleted: false, deletedAt: null } : it)
}

// Drop the matching item entirely. Used by "permanently delete" actions.
export function permanentlyDelete<T extends SoftDeletable>(items: T[], id: string): T[] {
  return items.filter(it => it.id !== id)
}

// Drop every soft-deleted item.
export function emptyTrash<T extends SoftDeletable>(items: T[]): T[] {
  return items.filter(it => !it.isDeleted)
}
