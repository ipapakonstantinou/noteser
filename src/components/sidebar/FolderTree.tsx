'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useNoteStore, useFolderStore, useUIStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { useHydration } from '@/hooks'
import { EditableText } from '../shared/EditableText'
import { collectAllTags } from '@/utils/tags'
import { sortNotes } from '@/utils/sortNotes'
import {
  listAttachmentMeta,
  getAttachmentUrl,
  moveAttachment,
  type AttachmentMeta,
} from '@/utils/attachments'
import { ATTACHMENTS_CHANGED_EVENT } from '@/utils/events'
import { rewriteAttachmentRefs } from '@/utils/attachmentRefs'

interface FolderTreeProps {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

export const FolderTree = ({ onRightClick }: FolderTreeProps) => {
  const hydrated = useHydration()
  const { currentView } = useUIStore()
  const renameRequest = useUIStore(s => s.renameRequest)
  const clearRenameRequest = useUIStore(s => s.clearRenameRequest)
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const {
    notes,
    selectedNoteId,
    updateNote,
    moveNoteToFolder,
    getActiveNotes,
    getDeletedNotes,
    getRecentNotes,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash
  } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)
  const {
    folders,
    activeFolderId,
    expandedFolders,
    setActiveFolder,
    toggleFolderExpanded,
    updateFolder,
    getRootFolders,
    getChildFolders
  } = useFolderStore()

  // Use empty arrays during SSR to avoid hydration mismatch
  const rootFolders = useMemo(() => hydrated ? getRootFolders() : [], [folders, hydrated])
  const activeNotes = useMemo(() => hydrated ? getActiveNotes() : [], [notes, hydrated])
  const deletedNotes = useMemo(() => hydrated ? getDeletedNotes() : [], [notes, hydrated])
  const recentNotes = useMemo(() => hydrated ? getRecentNotes(10) : [], [notes, hydrated])

  // Tags are derived from #word patterns in note bodies — recomputed when
  // notes change. No more entity store.
  const tagCounts = useMemo(() => collectAllTags(activeNotes), [activeNotes])

  // ── Attachment metadata (for rendering inside parent folders) ────────────
  // The IDB attachment store is mirrored here so we can render each
  // attachment file inside its parent folder (alongside notes). Refreshed on
  // any save / put / delete via the global ATTACHMENTS_CHANGED_EVENT.
  const [attachmentMeta, setAttachmentMeta] = useState<AttachmentMeta[]>([])
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const load = () => {
      listAttachmentMeta().then(m => {
        if (!cancelled) setAttachmentMeta(m)
      })
    }
    load()
    window.addEventListener(ATTACHMENTS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(ATTACHMENTS_CHANGED_EVENT, load)
    }
  }, [hydrated])

  // ── Drag & drop state ───────────────────────────────────────────────────
  // Generalised across notes + attachments so the same drop zones accept
  // both. Kept in a ref so dragstart doesn't trigger a re-render.
  type DraggedItem =
    | { kind: 'note'; id: string }
    | { kind: 'attachment'; path: string }
  const draggedItemRef = useRef<DraggedItem | null>(null)
  // Visual highlight target: folder id, or '__root__' for the root drop zone.
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  // ── Single vs double click on a note ────────────────────────────────────
  // Single click = open as preview (italic, replaceable). Double click =
  // open as pinned. We delay the single-click handler so a quick second
  // click cancels it (matches VS Code's explorer behaviour).
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleNoteClick = (id: string) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      openNote(id, { preview: true })
      clickTimerRef.current = null
    }, 200)
  }
  const handleNoteDoubleClick = (id: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    openNote(id, { preview: false })
  }

  const beginNoteDrag = (e: React.DragEvent, noteId: string) => {
    draggedItemRef.current = { kind: 'note', id: noteId }
    // Required for Firefox to register the drag; also exposes the id to drop.
    e.dataTransfer.setData('application/x-noteser-note', noteId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const beginAttachmentDrag = (e: React.DragEvent, path: string) => {
    draggedItemRef.current = { kind: 'attachment', path }
    e.dataTransfer.setData('application/x-noteser-attachment', path)
    e.dataTransfer.effectAllowed = 'move'
  }
  const endDrag = () => {
    draggedItemRef.current = null
    setDragOverTarget(null)
  }

  // Move an attachment into the given folder (or root). Renames the IDB key
  // to `<target-repo-path>/<filename>`, then rewrites every note's content
  // so `![](old-path)` becomes `![](new-path)` — Obsidian-style "Update
  // internal links". Silently no-ops on collision (rare; user can rename
  // and try again).
  const moveAttachmentToFolder = async (path: string, targetFolderId: string | null) => {
    const filename = path.split('/').pop() ?? path
    const targetRepoPath = targetFolderId
      ? folderRepoPathById.get(targetFolderId) ?? ''
      : ''
    const newPath = targetRepoPath ? `${targetRepoPath}/${filename}` : filename
    if (newPath === path) return
    try {
      await moveAttachment(path, newPath)
    } catch (err) {
      console.error('Failed to move attachment:', err)
      return
    }
    // Update note content. Pull a fresh snapshot of notes and rewrite refs.
    const { notes: liveNotes, updateNote } = useNoteStore.getState()
    for (const note of liveNotes) {
      if (note.isDeleted) continue
      const next = rewriteAttachmentRefs(note.content, path, newPath)
      if (next !== note.content) updateNote(note.id, { content: next })
    }
  }

  const onFolderDragOver = (e: React.DragEvent, folderId: string) => {
    if (!draggedItemRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTarget !== folderId) setDragOverTarget(folderId)
  }
  const onFolderDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    const item = draggedItemRef.current
    if (item?.kind === 'note') moveNoteToFolder(item.id, folderId)
    else if (item?.kind === 'attachment') void moveAttachmentToFolder(item.path, folderId)
    endDrag()
  }
  const onRootDragOver = (e: React.DragEvent) => {
    if (!draggedItemRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTarget !== '__root__') setDragOverTarget('__root__')
  }
  const onRootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const item = draggedItemRef.current
    if (item?.kind === 'note') moveNoteToFolder(item.id, null)
    else if (item?.kind === 'attachment') void moveAttachmentToFolder(item.path, null)
    endDrag()
  }

  // ── Attachment-as-file render helpers ────────────────────────────────────
  // Attachments live in real Folder entities now (materialised on save / pull
  // via folderStore.ensureFolderPath). Inside any FolderItem we render the
  // matching attachments alongside the folder's notes.

  const openAttachment = async (path: string) => {
    const url = await getAttachmentUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  // Strip the leading directory + the timestamp prefix our saver adds so
  // the original filename shows.
  const attachmentDisplayName = (path: string): string => {
    const file = path.replace(/^.*\//, '')
    const match = file.match(/^\d{14}-(.+)$/)
    return match ? match[1] : file
  }

  // Repo path (e.g. "attachments" or "Notes/Daily") for every non-deleted
  // folder. Built once per render so attachment → folder lookup is O(1).
  const folderRepoPathById = useMemo(() => {
    const byId = new Map(folders.map(f => [f.id, f]))
    const out = new Map<string, string>()
    for (const f of folders) {
      if (f.isDeleted) continue
      const segs: string[] = []
      let cur: typeof folders[0] | undefined = f
      for (let i = 0; cur && i < 32; i++) {
        if (cur.isDeleted) break
        segs.unshift(cur.name)
        cur = cur.parentId ? byId.get(cur.parentId) : undefined
      }
      out.set(f.id, segs.join('/'))
    }
    return out
  }, [folders])

  // Group attachments by their parent directory path so each FolderItem can
  // grab "its" attachments without scanning the whole list.
  const attachmentsByParentPath = useMemo(() => {
    const out = new Map<string, AttachmentMeta[]>()
    for (const m of attachmentMeta) {
      const slash = m.path.lastIndexOf('/')
      if (slash === -1) continue
      const parent = m.path.slice(0, slash)
      const existing = out.get(parent)
      if (existing) existing.push(m)
      else out.set(parent, [m])
    }
    return out
  }, [attachmentMeta])

  const AttachmentItem = ({ m }: { m: AttachmentMeta }) => (
    <div
      className="obsidian-file-item"
      draggable
      onDragStart={e => beginAttachmentDrag(e, m.path)}
      onDragEnd={endDrag}
      onClick={() => openAttachment(m.path)}
      title={m.path}
    >
      <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="flex-1 truncate">{attachmentDisplayName(m.path)}</span>
    </div>
  )

  // Render note item
  const NoteItem = ({ note, className = '' }: { note: typeof notes[0]; className?: string }) => {
    return (
      <div
        className={`obsidian-file-item ${
          selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
        } ${className}`}
        draggable={currentView !== 'trash'}
        onDragStart={e => beginNoteDrag(e, note.id)}
        onDragEnd={endDrag}
        onClick={() => handleNoteClick(note.id)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
        onContextMenu={e => onRightClick(e, 'note', note.id)}
      >
        <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {note.isPinned && (
              <StarIconSolid className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            )}
            {currentView === 'trash' ? (
              <span className="truncate">{note.title}</span>
            ) : (
              <EditableText
                value={note.title}
                onSave={newTitle => updateNote(note.id, { title: newTitle })}
                isEditing={renameRequest?.type === 'note' && renameRequest.id === note.id}
                onEditingChange={(v) => { if (!v) clearRenameRequest() }}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // A folder is "hidden" if its name starts with `.` — convention borrowed
  // from Unix dotfiles. The synthetic attachments folder is also hidden.
  const isHiddenFolderName = (name: string): boolean => name.startsWith('.')
  const filterHidden = <T extends { name: string }>(items: T[]): T[] =>
    showHiddenFolders ? items : items.filter(f => !isHiddenFolderName(f.name))

  // Render folder with its child folders + its notes (recursive)
  const FolderItem = ({ folder, depth = 0 }: { folder: typeof folders[0]; depth?: number }) => {
    const isExpanded = expandedFolders[folder.id]
    const isActive = activeFolderId === folder.id
    const folderNotes = sortNotes(activeNotes.filter(n => n.folderId === folder.id), folderSortMode)
    const childFolders = filterHidden(hydrated ? getChildFolders(folder.id) : [])
    const repoPath = folderRepoPathById.get(folder.id) ?? ''
    const folderAttachments = attachmentsByParentPath.get(repoPath) ?? []
    const childCount = folderNotes.length + childFolders.length + folderAttachments.length

    const isDropTarget = dragOverTarget === folder.id
    return (
      <div className="mb-0.5">
        <div
          className={`obsidian-folder-item ${
            isActive ? 'bg-obsidianHighlight' : ''
          } ${isDropTarget ? 'outline outline-2 outline-obsidianAccentPurple bg-obsidianAccentPurple/10' : ''}`}
          style={{ paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : undefined }}
          onClick={() => setActiveFolder(folder.id)}
          onContextMenu={e => onRightClick(e, 'folder', folder.id)}
          onDragOver={e => onFolderDragOver(e, folder.id)}
          onDragLeave={() => { if (dragOverTarget === folder.id) setDragOverTarget(null) }}
          onDrop={e => onFolderDrop(e, folder.id)}
        >
          <button
            className="mr-1 focus:outline-none"
            onClick={e => {
              e.stopPropagation()
              toggleFolderExpanded(folder.id)
            }}
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </button>
          <FolderIcon className="w-4 h-4 mr-1.5 text-obsidianSecondaryText" />
          <EditableText
            value={folder.name}
            onSave={newName => updateFolder(folder.id, { name: newName })}
            isEditing={renameRequest?.type === 'folder' && renameRequest.id === folder.id}
            onEditingChange={(v) => { if (!v) clearRenameRequest() }}
          />
          {childCount > 0 && (
            <span className="ml-auto text-xs text-obsidianSecondaryText">
              {childCount}
            </span>
          )}
        </div>
        {isExpanded && (
          <div>
            {/* Nested child folders first */}
            {childFolders.map(child => (
              <FolderItem key={child.id} folder={child} depth={depth + 1} />
            ))}
            {/* Then notes + attachments inside this folder */}
            <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              {folderNotes.map(note => (
                <NoteItem key={note.id} note={note} />
              ))}
              {folderAttachments.map(m => (
                <AttachmentItem key={m.path} m={m} />
              ))}
              {folderNotes.length === 0 && childFolders.length === 0 && folderAttachments.length === 0 && (
                <div className="px-3 py-2 text-xs text-obsidianSecondaryText italic">
                  Empty folder
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render trash view
  if (currentView === 'trash') {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
            Trash ({deletedNotes.length})
          </h3>
          {deletedNotes.length > 0 && (
            <button
              onClick={emptyTrash}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Empty Trash
            </button>
          )}
        </div>
        {deletedNotes.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">Trash is empty</p>
          </div>
        ) : (
          deletedNotes.map(note => (
            <div
              key={note.id}
              className={`obsidian-file-item ${
                selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
              }`}
              onClick={() => handleNoteClick(note.id)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
            >
              <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
              <span className="flex-1 truncate">{note.title}</span>
              <div className="flex gap-1">
                <button
                  onClick={e => {
                    e.stopPropagation()
                    restoreNote(note.id)
                  }}
                  className="text-xs text-obsidianAccentPurple hover:text-obsidianText transition-colors"
                >
                  Restore
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    permanentlyDeleteNote(note.id)
                  }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  // Render recent view
  if (currentView === 'recent') {
    return (
      <div>
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
          Recently Modified
        </h3>
        {recentNotes.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">No recent notes</p>
          </div>
        ) : (
          recentNotes.map(note => (
            <NoteItem key={note.id} note={note} />
          ))
        )}
      </div>
    )
  }

  // Render tags view — derived from #word patterns in note bodies.
  if (currentView === 'tags') {
    const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    return (
      <div>
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
          Tags
        </h3>
        {sortedTags.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">No tags yet</p>
            <p className="text-xs mt-1">Type <code className="text-obsidianAccentPurple">#tagname</code> anywhere in a note</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedTags.map(([name, count]) => (
              <div
                key={name}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-obsidianDarkGray cursor-default"
              >
                <span className="text-sm text-obsidianAccentPurple font-medium">#{name}</span>
                <span className="ml-auto text-xs text-obsidianSecondaryText">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Render default notes view — Obsidian-style flat tree.
  // Order matches a GitHub repo's file browser: folders first, then notes
  // (including pinned ones — they're still distinguishable by their pin
  // icon but no longer get hoisted above the folder list).
  const rootNotes = sortNotes(activeNotes.filter(n => !n.folderId), folderSortMode)

  if (rootFolders.length === 0 && rootNotes.length === 0 && attachmentMeta.length === 0) {
    return (
      <div
        className={`text-center py-8 text-obsidianSecondaryText min-h-full ${
          dragOverTarget === '__root__' ? 'outline outline-2 outline-obsidianAccentPurple' : ''
        }`}
        onDragOver={onRootDragOver}
        onDragLeave={() => { if (dragOverTarget === '__root__') setDragOverTarget(null) }}
        onDrop={onRootDrop}
      >
        <p className="text-sm">No notes yet</p>
        <p className="text-xs mt-1">Click + to create your first note</p>
      </div>
    )
  }

  const rootHighlighted = dragOverTarget === '__root__'

  // Root folders sort alphabetically (case-insensitive) — `filterHidden`
  // drops dotfile names when the setting is off.
  const visibleRootFolders = filterHidden(rootFolders).slice().sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  // Root-level attachments (path with no slash before the file part) —
  // unusual but supported. Render them inline with root notes.
  const rootAttachments = attachmentsByParentPath.get('') ?? []

  return (
    <div
      className={`min-h-full ${rootHighlighted ? 'outline outline-2 outline-obsidianAccentPurple rounded' : ''}`}
      onDragOver={onRootDragOver}
      onDragLeave={(e) => {
        // Only clear when leaving the wrapper itself, not when crossing children.
        if (e.currentTarget === e.target && dragOverTarget === '__root__') setDragOverTarget(null)
      }}
      onDrop={onRootDrop}
    >
      {visibleRootFolders.map(folder => (
        <FolderItem key={folder.id} folder={folder} />
      ))}
      {rootNotes.map(note => (
        <NoteItem key={note.id} note={note} />
      ))}
      {rootAttachments.map(m => (
        <AttachmentItem key={m.path} m={m} />
      ))}
    </div>
  )
}

export default FolderTree
