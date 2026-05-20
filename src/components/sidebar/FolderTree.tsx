'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useNoteStore, useFolderStore, useUIStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { useHydration, useTreeDragDrop } from '@/hooks'
import { EditableText } from '../shared/EditableText'
import { collectAllTags } from '@/utils/tags'
import { sortNotes } from '@/utils/sortNotes'
import {
  getFlattenedTreeOrder,
  findRowIndex,
  findNextRowByLetter,
  type TreeRow,
} from '@/utils/treeNav'
import {
  listAttachmentMeta,
  getAttachmentUrl,
  type AttachmentMeta,
} from '@/utils/attachments'
import { ATTACHMENTS_CHANGED_EVENT } from '@/utils/events'
import { revealNote } from '@/utils/revealNote'

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

  // Use empty arrays during SSR to avoid hydration mismatch. `folders`/
  // `notes` are the triggers; the get*() helpers pull fresh state from
  // their stores internally so they don't need to be in the deps.
  /* eslint-disable react-hooks/exhaustive-deps */
  const rootFolders = useMemo(() => hydrated ? getRootFolders() : [], [folders, hydrated])
  const activeNotes = useMemo(() => hydrated ? getActiveNotes() : [], [notes, hydrated])
  const deletedNotes = useMemo(() => hydrated ? getDeletedNotes() : [], [notes, hydrated])
  const recentNotes = useMemo(() => hydrated ? getRecentNotes(10) : [], [notes, hydrated])
  /* eslint-enable react-hooks/exhaustive-deps */

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

  // ── Multi-select (Ctrl/Cmd+Click toggle, Shift+Click range) ──────────────
  // Local state — bulk operations are a per-session intent, no reason to
  // persist. The last clicked id anchors the next Shift+Click's range.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastClickedIdRef = useRef<string | null>(null)
  const isSelected = (id: string) => selectedIds.has(id)
  const clearSelection = () => setSelectedIds(new Set())

  // Bulk delete with optional confirm. Setting is in Settings → General.
  const confirmBulkDelete = useSettingsStore(s => s.confirmBulkDelete)
  const deleteSelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const verb = useSettingsStore.getState().trashMode === 'hardDelete'
      ? 'permanently delete'
      : 'move to trash'
    if (confirmBulkDelete) {
      const ok = window.confirm(
        `${verb[0].toUpperCase() + verb.slice(1)} ${ids.length} note${ids.length === 1 ? '' : 's'}?`,
      )
      if (!ok) return
    }
    useNoteStore.getState().deleteNotes(ids)
    clearSelection()
  }

  // ── Single vs double click on a note ────────────────────────────────────
  // Single click = open as preview (italic, replaceable). Double click =
  // open as pinned. We delay the single-click handler so a quick second
  // click cancels it (matches VS Code's explorer behaviour).
  //
  // When the click originates from a non-tree view (Recent/Tags/etc.) we
  // also call revealNote so the user sees where the note lives. Reveal
  // switches the current view to 'notes' as a side-effect.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleNoteClick = (id: string, e?: React.MouseEvent) => {
    const fromNonTreeView = currentView !== 'notes' && currentView !== 'trash'

    // ── Multi-select branches ─────────────────────────────────────────────
    // Ctrl/Cmd+Click toggles the row in the selection set.
    if (e && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      lastClickedIdRef.current = id
      return
    }
    // Shift+Click selects a contiguous range from the last-clicked row
    // through this row, in flattenedRows order. Includes both ends.
    if (e && e.shiftKey && lastClickedIdRef.current) {
      const anchor = lastClickedIdRef.current
      const order = flattenedRows.filter(r => r.kind === 'note').map(r => r.id)
      const i1 = order.indexOf(anchor)
      const i2 = order.indexOf(id)
      if (i1 !== -1 && i2 !== -1) {
        const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1]
        const range = new Set(order.slice(lo, hi + 1))
        setSelectedIds(range)
      }
      return
    }

    // Plain click: clear the selection (so the user knows multi-mode ended)
    // + open the note as preview after the double-click guard.
    if (selectedIds.size > 0) clearSelection()
    lastClickedIdRef.current = id
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      openNote(id, { preview: true })
      if (fromNonTreeView) revealNote(id)
      clickTimerRef.current = null
    }, 200)
  }
  const handleNoteDoubleClick = (id: string) => {
    const fromNonTreeView = currentView !== 'notes' && currentView !== 'trash'
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    openNote(id, { preview: false })
    if (fromNonTreeView) revealNote(id)
  }

  // ── Attachment helpers ─────────────────────────────────────────────────
  // Attachments live in real Folder entities now (materialised on save /
  // pull via folderStore.ensureFolderPath). Inside any FolderItem we
  // render the matching attachments alongside the folder's notes.

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

  // ── Keyboard navigation ────────────────────────────────────────────────
  // The folder tree behaves as a single roving-tabindex group: the
  // outermost div is the only Tab stop, and a single `focusedRow` marks
  // which row is "selected" by the keyboard. Arrow keys move the marker;
  // Enter / Space act on it. A flattened view of the visible rows powers
  // every navigation primitive (next/prev, jump-to-letter, expand/collapse).
  const [focusedRow, setFocusedRow] = useState<{ kind: 'folder' | 'note'; id: string } | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)

  // Cached flattened order — recomputed when folders/notes/expansion
  // change. Notes inside each folder follow the configured sort mode so
  // arrow-down matches the visible order exactly.
  const flattenedRows = useMemo<TreeRow[]>(() => {
    if (!hydrated) return []
    return getFlattenedTreeOrder(folders, notes, expandedFolders, {
      showHiddenFolders,
      noteSortMode: folderSortMode,
    })
  }, [hydrated, folders, notes, expandedFolders, showHiddenFolders, folderSortMode])

  // Find-as-you-type: we use a single-letter prefix that always searches
  // forward from the currently focused row, wrapping around. Repeated taps
  // of the same letter cycle through all matches, so no timed buffer is
  // needed — the cursor's position carries all the state we need.

  // If focus drifts to a now-hidden row (e.g. user collapsed the parent),
  // snap it to that parent so the user doesn't get a stale highlight.
  useEffect(() => {
    if (!focusedRow) return
    if (findRowIndex(flattenedRows, focusedRow.kind, focusedRow.id) !== -1) return
    // Try to find any ancestor folder that is still visible.
    if (focusedRow.kind === 'note' || focusedRow.kind === 'folder') {
      // Walk up parents using the folder store.
      const folderById = new Map(folders.map(f => [f.id, f]))
      let parentId: string | null | undefined = focusedRow.kind === 'folder'
        ? folderById.get(focusedRow.id)?.parentId ?? null
        : notes.find(n => n.id === focusedRow.id)?.folderId ?? null
      while (parentId) {
        if (findRowIndex(flattenedRows, 'folder', parentId) !== -1) {
          setFocusedRow({ kind: 'folder', id: parentId })
          return
        }
        parentId = folderById.get(parentId)?.parentId ?? null
      }
    }
    setFocusedRow(null)
  }, [flattenedRows, focusedRow, folders, notes])

  const moveFocusToIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= flattenedRows.length) return
    const row = flattenedRows[idx]
    setFocusedRow({ kind: row.kind, id: row.id })
  }, [flattenedRows])

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Bail out cleanly while typing in nested inline rename inputs — the
    // EditableText component renders an <input> inside the tree, and we
    // don't want arrow keys / letter keys hijacking text input.
    const target = e.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }

    if (flattenedRows.length === 0) return

    const currentIndex = focusedRow
      ? findRowIndex(flattenedRows, focusedRow.kind, focusedRow.id)
      : -1
    const currentRow = currentIndex >= 0 ? flattenedRows[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, flattenedRows.length - 1)
        moveFocusToIndex(next)
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        const next = currentIndex <= 0 ? 0 : currentIndex - 1
        moveFocusToIndex(next)
        return
      }
      case 'Home': {
        e.preventDefault()
        moveFocusToIndex(0)
        return
      }
      case 'End': {
        e.preventDefault()
        moveFocusToIndex(flattenedRows.length - 1)
        return
      }
      case 'ArrowRight': {
        if (!currentRow) return
        if (currentRow.kind === 'folder') {
          e.preventDefault()
          if (!expandedFolders[currentRow.id]) {
            toggleFolderExpanded(currentRow.id)
          } else if (currentIndex + 1 < flattenedRows.length) {
            // Move into the first child if there is one (depth strictly
            // greater than the folder's depth).
            const child = flattenedRows[currentIndex + 1]
            if (child.depth > currentRow.depth) moveFocusToIndex(currentIndex + 1)
          }
        }
        return
      }
      case 'ArrowLeft': {
        if (!currentRow) return
        e.preventDefault()
        if (currentRow.kind === 'folder' && expandedFolders[currentRow.id]) {
          toggleFolderExpanded(currentRow.id)
          return
        }
        // Otherwise jump to the parent folder row if one exists.
        if (currentRow.parentFolderId) {
          const parentIdx = findRowIndex(flattenedRows, 'folder', currentRow.parentFolderId)
          if (parentIdx !== -1) moveFocusToIndex(parentIdx)
        }
        return
      }
      case 'Enter': {
        if (!currentRow) return
        e.preventDefault()
        if (currentRow.kind === 'note') {
          // Enter = pinned open (matches double-click).
          openNote(currentRow.id, { preview: false })
        } else {
          toggleFolderExpanded(currentRow.id)
        }
        return
      }
      case ' ': {
        // Space toggles expansion on folders; ignored on notes.
        if (!currentRow || currentRow.kind !== 'folder') return
        e.preventDefault()
        toggleFolderExpanded(currentRow.id)
        return
      }
      case 'Delete':
      case 'Backspace': {
        // Bulk-delete trigger when there's a multi-select active.
        if (selectedIds.size === 0) return
        e.preventDefault()
        deleteSelected()
        return
      }
      case 'Escape': {
        // Clear multi-select on Escape. Doesn't preventDefault when there
        // was nothing selected — Escape might still need to close a modal
        // via the global keyboard hook.
        if (selectedIds.size === 0) return
        e.preventDefault()
        clearSelection()
        return
      }
      default: {
        // Find-as-you-type: single printable letter, no modifiers.
        if (
          e.key.length === 1 &&
          /^[a-z0-9]$/i.test(e.key) &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault()
          const nextIdx = findNextRowByLetter(flattenedRows, e.key, currentIndex)
          if (nextIdx !== -1) moveFocusToIndex(nextIdx)
        }
      }
    }
    // selectedIds + deleteSelected are read directly; including them in
    // deps would re-bind the handler on every selection change which is
    // wasted work — both close over fresh refs via state/ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flattenedRows, focusedRow, expandedFolders, toggleFolderExpanded, openNote, moveFocusToIndex])

  // Initialise the focused row when the tree first gains focus and nothing
  // is selected yet — drops the user on the first visible row.
  const handleTreeFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.target !== treeRef.current) return
    if (focusedRow) return
    if (flattenedRows.length > 0) {
      setFocusedRow({ kind: flattenedRows[0].kind, id: flattenedRows[0].id })
    }
  }, [flattenedRows, focusedRow])

  const isRowFocused = (kind: 'folder' | 'note', id: string): boolean =>
    !!focusedRow && focusedRow.kind === kind && focusedRow.id === id

  // ── Drag & drop ───────────────────────────────────────────────────────
  // All begin/over/drop/end handlers + the dragOverTarget state come from
  // the useTreeDragDrop hook, which also owns the cross-cutting logic of
  // moving an attachment (rename IDB key + rewrite refs across notes).
  const {
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
  } = useTreeDragDrop({
    getFolderRepoPath: (id) => folderRepoPathById.get(id),
  })

  const AttachmentItem = ({ m }: { m: AttachmentMeta }) => (
    <div
      className="obsidian-file-item"
      draggable
      onDragStart={e => beginAttachmentDrag(e, m.path)}
      onDragEnd={endDrag}
      onClick={() => openAttachment(m.path)}
      title={m.path}
      data-testid="attachment-row"
      data-attachment-path={m.path}
    >
      <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="flex-1 truncate">{attachmentDisplayName(m.path)}</span>
    </div>
  )

  // Render note item
  const NoteItem = ({ note, className = '' }: { note: typeof notes[0]; className?: string }) => {
    const kbFocused = isRowFocused('note', note.id)
    const multiSelected = isSelected(note.id)
    return (
      <div
        className={`obsidian-file-item ${
          multiSelected ? 'bg-obsidianAccentPurple/25 border-l-2 border-obsidianAccentPurple -ml-[2px] pl-[10px]' :
            selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
        } ${kbFocused ? 'ring-1 ring-inset ring-obsidianAccentPurple' : ''} ${className}`}
        draggable={currentView !== 'trash' && !multiSelected}
        onDragStart={e => beginNoteDrag(e, note.id)}
        onDragEnd={endDrag}
        onClick={(e) => handleNoteClick(note.id, e)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
        onContextMenu={e => onRightClick(e, 'note', note.id)}
        tabIndex={-1}
        data-testid="note-row"
        data-note-id={note.id}
        data-kb-focused={kbFocused ? 'true' : undefined}
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
    const kbFocused = isRowFocused('folder', folder.id)
    return (
      <div className="mb-0.5">
        <div
          className={`obsidian-folder-item ${
            isActive ? 'bg-obsidianHighlight' : ''
          } ${isDropTarget ? 'outline outline-2 outline-obsidianAccentPurple bg-obsidianAccentPurple/10' : ''} ${
            kbFocused ? 'ring-1 ring-inset ring-obsidianAccentPurple' : ''
          }`}
          style={{ paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : undefined }}
          onClick={() => setActiveFolder(folder.id)}
          onContextMenu={e => onRightClick(e, 'folder', folder.id)}
          onDragOver={e => onFolderDragOver(e, folder.id)}
          onDragLeave={() => onFolderDragLeave(folder.id)}
          onDrop={e => onFolderDrop(e, folder.id)}
          tabIndex={-1}
          data-testid="folder-row"
          data-folder-name={folder.name}
          data-folder-id={folder.id}
          data-kb-focused={kbFocused ? 'true' : undefined}
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
        ref={treeRef}
        data-testid="folder-tree"
        tabIndex={0}
        role="tree"
        aria-label="Folder tree"
        className={`text-center py-8 text-obsidianSecondaryText min-h-full outline-none ${
          dragOverTarget === '__root__' ? 'outline outline-2 outline-obsidianAccentPurple' : ''
        }`}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
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
      ref={treeRef}
      data-testid="folder-tree"
      tabIndex={0}
      role="tree"
      aria-label="Folder tree"
      className={`min-h-full outline-none ${rootHighlighted ? 'outline outline-2 outline-obsidianAccentPurple rounded' : ''}`}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
      onKeyDown={handleTreeKeyDown}
      onFocus={handleTreeFocus}
    >
      {selectedIds.size > 0 && (
        <div
          className="sticky top-0 z-10 mb-1 flex items-center gap-2 px-2 py-1.5 bg-obsidianAccentPurple/15 border border-obsidianAccentPurple/40 rounded text-xs"
          data-testid="multiselect-bar"
        >
          <span className="text-obsidianAccentPurple font-medium">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => deleteSelected()}
            className="ml-auto px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25"
            data-testid="multiselect-delete"
            title="Delete selected (Del / Backspace)"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="px-2 py-0.5 rounded text-obsidianSecondaryText hover:text-obsidianText"
          >
            Clear
          </button>
        </div>
      )}
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
