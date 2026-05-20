'use client'

import { useCallback, useRef, useState } from 'react'
import { useNoteStore, useFolderStore } from '@/stores'
import { moveAttachmentAndRewriteRefs } from '@/utils/attachments'

// Drag-and-drop state + handlers for the folder tree. Owns the dragged-item
// ref + the highlighted-drop-target state, and exposes the begin / over /
// drop / end handlers needed by FolderTree's render. Pulled out of
// FolderTree.tsx so the drag plumbing can evolve independently of the
// render code (and so the same handlers can power any other tree-like UI
// later — e.g. a calendar view).

type DraggedItem =
  | { kind: 'note'; id: string }
  | { kind: 'attachment'; path: string }
  | { kind: 'folder'; id: string }

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
  beginFolderDrag: (e: React.DragEvent, folderId: string) => void
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
  const updateFolder = useFolderStore(s => s.updateFolder)

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

  const beginFolderDrag = useCallback((e: React.DragEvent, folderId: string) => {
    draggedItemRef.current = { kind: 'folder', id: folderId }
    e.dataTransfer.setData('application/x-noteser-folder', folderId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  // Walk the folder hierarchy to find every descendant of `rootId`
  // (NOT including rootId itself). Used to prevent cycles: you can't
  // drop a folder into its own subtree.
  const collectDescendantFolderIds = useCallback((rootId: string): Set<string> => {
    const out = new Set<string>()
    const folders = useFolderStore.getState().folders
    const queue: string[] = [rootId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const f of folders) {
        if (!f.isDeleted && f.parentId === cur && !out.has(f.id)) {
          out.add(f.id)
          queue.push(f.id)
        }
      }
    }
    return out
  }, [])

  // Apply a folder-move. Validates: dropping onto self is a no-op;
  // dropping into own descendant is rejected (cycle); dropping into
  // current parent is a no-op.
  const moveFolderToFolder = useCallback(
    (folderId: string, targetParentId: string | null) => {
      const folders = useFolderStore.getState().folders
      const folder = folders.find(f => f.id === folderId)
      if (!folder) return
      if (folder.parentId === targetParentId) return
      if (targetParentId === folderId) return
      if (targetParentId !== null) {
        const descendants = collectDescendantFolderIds(folderId)
        if (descendants.has(targetParentId)) return
      }
      updateFolder(folderId, { parentId: targetParentId })
    },
    [updateFolder, collectDescendantFolderIds],
  )

  const endDrag = useCallback(() => {
    draggedItemRef.current = null
    setDragOverTarget(null)
  }, [])

  // Compose the target path, then delegate to the module-level helper
  // that handles the IDB rename + the batched per-note ref rewrite.
  // Same-folder drops short-circuit before touching IDB so a misclick
  // doesn't trigger the (no-op) move pipeline.
  const moveAttachmentToFolder = useCallback(
    async (path: string, targetFolderId: string | null) => {
      const filename = path.split('/').pop() ?? path
      const targetRepoPath = targetFolderId
        ? getFolderRepoPath(targetFolderId) ?? ''
        : ''
      const newPath = targetRepoPath ? `${targetRepoPath}/${filename}` : filename
      if (newPath === path) return
      try {
        await moveAttachmentAndRewriteRefs(path, newPath)
      } catch (err) {
        console.error('Failed to move attachment:', err)
      }
    },
    [getFolderRepoPath],
  )

  const onFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    if (!draggedItemRef.current) return
    e.preventDefault()
    // stopPropagation is the key fix for "drop to root doesn't work":
    // without it, the dragOver event bubbles up to the tree wrapper's
    // onRootDragOver, which overrides the highlight to '__root__' even
    // though the cursor is over a folder row. The drop then goes into
    // the folder (child handler fires first), confusingly mismatching
    // the highlight.
    e.stopPropagation()
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
      // Pair with stopPropagation in onFolderDragOver — keeps the root
      // drop handler from running on top of this and re-applying the
      // wrong move.
      e.stopPropagation()
      const item = draggedItemRef.current
      if (item?.kind === 'note') moveNoteToFolder(item.id, folderId)
      else if (item?.kind === 'attachment') void moveAttachmentToFolder(item.path, folderId)
      else if (item?.kind === 'folder') moveFolderToFolder(item.id, folderId)
      endDrag()
    },
    [moveNoteToFolder, moveAttachmentToFolder, moveFolderToFolder, endDrag],
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
      else if (item?.kind === 'folder') moveFolderToFolder(item.id, null)
      endDrag()
    },
    [moveNoteToFolder, moveAttachmentToFolder, moveFolderToFolder, endDrag],
  )

  return {
    dragOverTarget,
    beginNoteDrag,
    beginAttachmentDrag,
    beginFolderDrag,
    endDrag,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  }
}
