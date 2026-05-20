'use client'

import { useUIStore, useNoteStore, useFolderStore, useSettingsStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { cascadeDeleteFolder } from '@/utils/cascadeDelete'

export const DeleteConfirmModal = () => {
  const { modal, closeModal } = useUIStore()
  const { deleteNote, permanentlyDeleteNote, getNoteById } = useNoteStore()
  const { permanentlyDeleteFolder, getFolderById } = useFolderStore()
  const { notes } = useNoteStore()
  const trashMode = useSettingsStore(s => s.trashMode)

  const isOpen = modal.type === 'delete'
  // Two payload shapes:
  //   - single: { type: 'note'|'folder', id, permanent? }
  //   - bulk:   { type: 'bulk', ids: string[] }
  type Single = { type: 'note' | 'folder'; id: string; permanent?: boolean }
  type Bulk = { type: 'bulk'; ids: string[] }
  const data = modal.data as Single | Bulk | undefined

  if (!isOpen || !data) return null

  const isBulk = data.type === 'bulk'
  const isNote = !isBulk && data.type === 'note'
  const isPermanent = !isBulk ? data.permanent : false
  const note = !isBulk && isNote ? getNoteById(data.id) : null
  const folder = !isBulk && !isNote ? getFolderById(data.id) : null
  const itemName = isNote ? note?.title : folder?.name

  const notesInFolder = !isBulk && !isNote
    ? notes.filter(n => n.folderId === data.id && !n.isDeleted)
    : []

  const handleDelete = () => {
    if (isBulk) {
      useNoteStore.getState().deleteNotes(data.ids)
      closeModal()
      return
    }
    if (isNote) {
      if (isPermanent) {
        permanentlyDeleteNote(data.id)
      } else {
        deleteNote(data.id)
      }
    } else {
      // For folders, hardDelete and "soft" both cascade attachment
      // tombstones + relocate notes to root. The only difference is
      // whether the folder entity is left in trash (recoverable) or
      // dropped outright. We always run cascade so the sync side stays
      // consistent regardless of the user's trash preference.
      if (isPermanent || trashMode === 'hardDelete') {
        cascadeDeleteFolder(data.id)
        permanentlyDeleteFolder(data.id)
      } else {
        // Soft delete: cascade. Tombstones attachments inside the folder
        // so the next sync push removes them remotely (otherwise pull
        // would re-derive the folder and resurrect it), cascade-deletes
        // descendant folders, and moves any contained notes to root.
        cascadeDeleteFolder(data.id)
      }
    }
    closeModal()
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="sm">
      <div className="text-center">
        <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-900/30 mb-4">
          <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
        </div>

        <h3 className="text-lg font-medium text-obsidianText mb-2">
          {isBulk
            ? (trashMode === 'hardDelete'
                ? `Permanently delete ${data.ids.length} notes?`
                : `Move ${data.ids.length} notes to trash?`)
            : `${isPermanent || trashMode === 'hardDelete' ? 'Permanently Delete' : 'Delete'} ${isNote ? 'Note' : 'Folder'}?`}
        </h3>

        <p className="text-sm text-obsidianSecondaryText mb-4">
          {isBulk ? (
            trashMode === 'hardDelete'
              ? `${data.ids.length} note${data.ids.length === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`
              : `${data.ids.length} note${data.ids.length === 1 ? '' : 's'} will be moved to trash. Recover them from the Trash view if needed.`
          ) : isPermanent || trashMode === 'hardDelete' ? (
            <>
              This action cannot be undone. &quot;{itemName}&quot; will be
              permanently deleted.
              {!isNote && notesInFolder.length > 0 && (
                <span className="block mt-2 text-yellow-500">
                  {notesInFolder.length} note{notesInFolder.length > 1 ? 's' : ''} in this
                  folder will be permanently deleted too.
                </span>
              )}
            </>
          ) : (
            <>
              &quot;{itemName}&quot; will be moved to trash.
              {!isNote && notesInFolder.length > 0 && (
                <span className="block mt-2 text-yellow-500">
                  {notesInFolder.length} note{notesInFolder.length > 1 ? 's' : ''} in this
                  folder will be moved to trash too.
                </span>
              )}
            </>
          )}
        </p>

        <div className="flex gap-3 justify-center">
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} data-testid="delete-confirm">
            {isBulk
              ? (trashMode === 'hardDelete' ? `Delete ${data.ids.length} forever` : `Move ${data.ids.length} to trash`)
              : (isPermanent || trashMode === 'hardDelete' ? 'Delete Forever' : 'Move to Trash')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteConfirmModal
