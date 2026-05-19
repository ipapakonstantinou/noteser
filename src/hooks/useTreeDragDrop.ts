'use client'

import { useCallback, useRef, useState } from 'react'
import { useNoteStore } from '@/stores'
import { moveAttachment } from '@/utils/attachments'
import { rewriteAttachmentRefs } from '@/utils/attachmentRefs'

// Drag-and-drop state + handlers for the folder tree. Owns the dragged-item
// ref + the highlighted-drop-target state, and exposes the begin / over /
// drop / end handlers needed by FolderTree's render. Pulled out of
// FolderTree.tsx so the drag plumbing can evolve independently of the
// render code (and so the same handlers can power any other tree-like UI
// later — e.g. a calendar view).

type DraggedItem =
  | { kind: 'note'; id: string }
  | { kind: 'attachment'; path: string }

export interface UseTreeDragDropOptions {
  // FolderTree computes folder repo paths anyway (to group attachments by
  // parent dir for rendering), so it passes a getter instead of us
  // recomputing the same map a second time.
  getFolderRepoPath: (folderId: string) => string | undefined
}

export interface TreeDragDropApi {
  // Currently highlighted drop target. `'__root__'` for the root drop
  // zone; null when nothing is being dragged over a valid target.
  dragOverTarget: string | null

  beginNoteDrag: (e: React.DragEvent, noteId: string) => void
  beginAttachmentDrag: (e: React.DragEvent, path: string) => void
  endDrag: () => void

  onFolderDragOver: (e: React.DragEvent, folderId: string) => void
  onFolderDragLeave: (folderId: string) => void
  onFolderDrop: (e: React.DragEvent, folderId: string) => void
  onRootDragOver: (e: React.DragEvent) => void
  onRootDragLeave: (e: React.DragEvent) => void
  onRootDrop: (e: React.DragEvent) => void
}

export function useTreeDragDrop({ getFolderRepoPath }: UseTreeDragDropOptions): TreeDragDropApi {
  const moveNoteToFolder = useNoteStore(s => s.moveNoteToFolder)

  // Kept in a ref so dragstart doesn't trigger a re-render; the highlight
  // target lives in state because the visual outline must re-render.
  const draggedItemRef = useRef<DraggedItem | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  const beginNoteDrag = useCallback((e: React.DragEvent, noteId: string) => {
    draggedItemRef.current = { kind: 'note', id: noteId }
    // Required for Firefox to register the drag; also exposes the id to drop.
    e.dataTransfer.setData('application/x-noteser-note', noteId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const beginAttachmentDrag = useCallback((e: React.DragEvent, path: string) => {
    draggedItemRef.current = { kind: 'attachment', path }
    e.dataTransfer.setData('application/x-noteser-attachment', path)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const endDrag = useCallback(() => {
    draggedItemRef.current = null
    setDragOverTarget(null)
  }, [])

  // Move an attachment into the given folder (or root). Renames the IDB
  // key to `<target-repo-path>/<filename>`, then rewrites every active
  // note's content so `![](old-path)` becomes `![](new-path)` —
  // Obsidian-style "Update internal links". Silently no-ops on collision.
  //
  // Note ref rewrites are batched into a SINGLE Zustand `setState` rather
  // than calling `updateNote` per note — otherwise N notes referencing the
  // same attachment caused N sequential re-renders that visibly flashed
  // the sidebar mid-drag.
  const moveAttachmentToFolder = useCallback(
    async (path: string, targetFolderId: string | null) => {
      const filename = path.split('/').pop() ?? path
      const targetRepoPath = targetFolderId
        ? getFolderRepoPath(targetFolderId) ?? ''
        : ''
      const newPath = targetRepoPath ? `${targetRepoPath}/${filename}` : filename
      if (newPath === path) return
      try {
        await moveAttachment(path, newPath)
      } catch (err) {
        console.error('Failed to move attachment:', err)
        return
      }
      // Compute every note's new content first; commit only the diffs in a
      // single setState so subscribers see one batched change.
      const now = Date.now()
      useNoteStore.setState(state => {
        let touched = false
        const nextNotes = state.notes.map(note => {
          if (note.isDeleted) return note
          const next = rewriteAttachmentRefs(note.content, path, newPath)
          if (next === note.content) return note
          touched = true
          return { ...note, content: next, updatedAt: now }
        })
        return touched ? { notes: nextNotes } : state
      })
    },
    [getFolderRepoPath],
  )

  const onFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    if (!draggedItemRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(prev => (prev !== folderId ? folderId : prev))
  }, [])

  // Clear the highlight when the cursor leaves a folder row. We compare
  // by id rather than blindly nulling so we don't clobber a fresh target
  // that another sibling's dragover already set.
  const onFolderDragLeave = useCallback((folderId: string) => {
    setDragOverTarget(prev => (prev === folderId ? null : prev))
  }, [])

  const onFolderDrop = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault()
      const item = draggedItemRef.current
      if (item?.kind === 'note') moveNoteToFolder(item.id, folderId)
      else if (item?.kind === 'attachment') void moveAttachmentToFolder(item.path, folderId)
      endDrag()
    },
    [moveNoteToFolder, moveAttachmentToFolder, endDrag],
  )

  const onRootDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedItemRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(prev => (prev !== '__root__' ? '__root__' : prev))
  }, [])

  // Root-drop-zone leave: only clear if the cursor actually leaves the
  // wrapper itself (not just crosses into a child folder row).
  const onRootDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget !== e.target) return
    setDragOverTarget(prev => (prev === '__root__' ? null : prev))
  }, [])

  const onRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const item = draggedItemRef.current
      if (item?.kind === 'note') moveNoteToFolder(item.id, null)
      else if (item?.kind === 'attachment') void moveAttachmentToFolder(item.path, null)
      endDrag()
    },
    [moveNoteToFolder, moveAttachmentToFolder, endDrag],
  )

  return {
    dragOverTarget,
    beginNoteDrag,
    beginAttachmentDrag,
    endDrag,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  }
}
