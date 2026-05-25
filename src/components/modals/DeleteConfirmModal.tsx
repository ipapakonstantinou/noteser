'use client'

import { useCallback, useEffect } from 'react'
import { useUIStore, useNoteStore, useFolderStore, useSettingsStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { cascadeDeleteFolder } from '@/utils/cascadeDelete'
import { TRASH_FOLDER_ID } from '@/utils/systemFolder'

export const DeleteConfirmModal = () => {
  const { modal, closeModal } = useUIStore()
  const { deleteNote, permanentlyDeleteNote, getNoteById, emptyTrash, getDeletedNotes } = useNoteStore()
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

  // Hooks must run unconditionally, so handleDelete + the keydown effect
  // live above the early-return below. They guard on isOpen + data
  // themselves.
  const handleDelete = useCallback(() => {
    if (!data) return
    if (data.type === 'bulk') {
      useNoteStore.getState().deleteNotes(data.ids)
      closeModal()
      return
    }
    const isPerm = !!(data as Single).permanent
    if (data.type === 'note') {
      if (isPerm) permanentlyDeleteNote(data.id)
      else deleteNote(data.id)
    } else if (data.id === TRASH_FOLDER_ID) {
      // `.trash` is a SYNTHETIC sidebar folder, not a real Folder entity.
      // Routing it through cascade/permanent-delete would tombstone a
      // `.trash` path in deletedFolderPaths AND leave the soft-deleted
      // notes intact — so a fresh empty synthetic `.trash` re-renders and
      // we end up with two `.trash` rows. "Deleting" the trash means
      // emptying it: hard-delete every soft-deleted note. Never touch
      // deletedFolderPaths.
      emptyTrash()
    } else {
      // For folders, hardDelete and "soft" both cascade attachment
      // tombstones + relocate notes to root. The only difference is
      // whether the folder entity is left in trash (recoverable) or
      // dropped outright. We always run cascade so the sync side stays
      // consistent regardless of the user's trash preference.
      if (isPerm || trashMode === 'hardDelete') {
        cascadeDeleteFolder(data.id)
        permanentlyDeleteFolder(data.id)
      } else {
        cascadeDeleteFolder(data.id)
      }
    }
    closeModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, trashMode])

  // Keyboard UX: Enter or Delete confirms; Escape cancels (Modal already
  // handles that). Window-level listener so focus location doesn't
  // matter — pairs with the user's "I hit Delete to open the modal,
  // I want to hit Enter (or Delete) to confirm" request.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
        // Don't hijack typing inside an input/textarea (no field
        // exists today, but future children might add one).
        const tgt = e.target as HTMLElement | null
        const tag = tgt?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return
        e.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, handleDelete])

  if (!isOpen || !data) return null

  const isBulk = data.type === 'bulk'
  const isNote = !isBulk && data.type === 'note'
  // The synthetic ".trash" folder isn't a real entity — "deleting" it
  // empties the trash. Special-case the copy so the user sees what will
  // actually happen.
  const isTrash = !isBulk && data.type === 'folder' && data.id === TRASH_FOLDER_ID
  const isPermanent = !isBulk ? data.permanent : false
  const note = !isBulk && isNote ? getNoteById(data.id) : null
  const folder = !isBulk && !isNote && !isTrash ? getFolderById(data.id) : null
  const itemName = isNote ? note?.title : folder?.name
  const trashedCount = isTrash ? getDeletedNotes().length : 0

  const notesInFolder = !isBulk && !isNote && !isTrash
    ? notes.filter(n => n.folderId === data.id && !n.isDeleted)
    : []

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="sm">
      <div className="text-center">
        <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-900/30 mb-4">
          <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
        </div>

        <h3 className="text-lg font-medium text-obsidianText mb-2">
          {isTrash
            ? 'Empty Trash?'
            : isBulk
            ? (trashMode === 'hardDelete'
                ? `Permanently delete ${data.ids.length} notes?`
                : `Move ${data.ids.length} notes to trash?`)
            : `${isPermanent || trashMode === 'hardDelete' ? 'Permanently Delete' : 'Delete'} ${isNote ? 'Note' : 'Folder'}?`}
        </h3>

        <p className="text-sm text-obsidianSecondaryText mb-4">
          {isTrash ? (
            `This action cannot be undone. ${trashedCount} note${trashedCount === 1 ? '' : 's'} in the trash will be permanently deleted.`
          ) : isBulk ? (
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
            {isTrash
              ? 'Empty Trash'
              : isBulk
              ? (trashMode === 'hardDelete' ? `Delete ${data.ids.length} forever` : `Move ${data.ids.length} to trash`)
              : (isPermanent || trashMode === 'hardDelete' ? 'Delete Forever' : 'Move to Trash')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteConfirmModal
