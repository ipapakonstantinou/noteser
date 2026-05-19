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
  const data = modal.data as { type: 'note' | 'folder'; id: string; permanent?: boolean } | undefined

  if (!isOpen || !data) return null

  const isNote = data.type === 'note'
  const isPermanent = data.permanent
  const note = isNote ? getNoteById(data.id) : null
  const folder = !isNote ? getFolderById(data.id) : null
  const itemName = isNote ? note?.title : folder?.name

  const notesInFolder = !isNote
    ? notes.filter(n => n.folderId === data.id && !n.isDeleted)
    : []

  const handleDelete = () => {
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
          {isPermanent || trashMode === 'hardDelete' ? 'Permanently Delete' : 'Delete'} {isNote ? 'Note' : 'Folder'}?
        </h3>

        <p className="text-sm text-obsidianSecondaryText mb-4">
          {isPermanent || trashMode === 'hardDelete' ? (
            <>
              This action cannot be undone. &quot;{itemName}&quot; will be
              permanently deleted.
              {!isNote && notesInFolder.length > 0 && (
                <span className="block mt-2 text-yellow-500">
                  {notesInFolder.length} note{notesInFolder.length > 1 ? 's' : ''} in this
                  folder will be moved to root.
                </span>
              )}
            </>
          ) : (
            <>
              &quot;{itemName}&quot; will be moved to trash.
              {!isNote && notesInFolder.length > 0 && (
                <span className="block mt-2 text-yellow-500">
                  {notesInFolder.length} note{notesInFolder.length > 1 ? 's' : ''} in this
                  folder will be moved to root.
                </span>
              )}
            </>
          )}
        </p>

        <div className="flex gap-3 justify-center">
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            {isPermanent || trashMode === 'hardDelete' ? 'Delete Forever' : 'Move to Trash'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteConfirmModal
