'use client'

import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export const DeleteConfirmModal = () => {
  const { modal, closeModal } = useUIStore()
  const { deleteNote, permanentlyDeleteNote, getNoteById } = useNoteStore()
  const { deleteFolder, permanentlyDeleteFolder, getFolderById } = useFolderStore()
  const { notes } = useNoteStore()

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
      // Move notes out of folder before deleting
      if (notesInFolder.length > 0) {
        const { updateNote } = useNoteStore.getState()
        notesInFolder.forEach(note => {
          updateNote(note.id, { folderId: null })
        })
      }
      if (isPermanent) {
        permanentlyDeleteFolder(data.id)
      } else {
        deleteFolder(data.id)
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
          {isPermanent ? 'Permanently Delete' : 'Delete'} {isNote ? 'Note' : 'Folder'}?
        </h3>

        <p className="text-sm text-obsidianSecondaryText mb-4">
          {isPermanent ? (
            <>
              This action cannot be undone. &quot;{itemName}&quot; will be
              permanently deleted.
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
            {isPermanent ? 'Delete Forever' : 'Move to Trash'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteConfirmModal
