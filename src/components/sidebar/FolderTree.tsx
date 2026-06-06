'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  DocumentTextIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useNoteStore, useFolderStore, useUIStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { useHydration, useTreeDragDrop, useViewport } from '@/hooks'
import { SwipePinRow } from './SwipePinRow'
import { EditableText } from '../shared/EditableText'
import { collectAllTags } from '@/utils/tags'
import { sortNotes } from '@/utils/sortNotes'
import type { Note } from '@/types'
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
import { TRASH_FOLDER_ID } from '@/utils/systemFolder'
import { buildTrashTree, type TrashFolderNode } from '@/utils/trashTree'
import { revealNote } from '@/utils/revealNote'

interface FolderTreeProps {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

export const FolderTree = ({ onRightClick }: FolderTreeProps) => {
  const hydrated = useHydration()
  const { currentView } = useUIStore()
  const renameRequest = useUIStore(s => s.renameRequest)
  const clearRenameRequest = useUIStore(s => s.clearRenameRequest)
  const compareSourceNoteId = useUIStore(s => s.compareSourceNoteId)
  const clearCompareSource = useUIStore(s => s.clearCompareSource)
  const { isMobile } = useViewport()
  const sidebarCollapsed = useUIStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  // After opening a note on mobile, dismiss the off-canvas drawer so
  // the user lands on the editor instead of staring at the sidebar
  // they just used. No-op on desktop.
  const closeDrawerIfMobile = useCallback(() => {
    if (isMobile && !sidebarCollapsed) toggleSidebar()
  }, [isMobile, sidebarCollapsed, toggleSidebar])
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const trashFolderName = useSettingsStore(s => s.trashFolderName)
  const {
    notes,
    selectedNoteId,
    updateNote,
    getActiveNotes,
    getDeletedNotes,
    getRecentNotes,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash,
    togglePinNote,
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
    getChildFolders,
    getDeletedFolders
  } = useFolderStore()

  // Use empty arrays during SSR to avoid hydration mismatch. `folders`/
  // `notes` are the triggers; the get*() helpers pull fresh state from
  // their stores internally so they don't need to be in the deps.
  /* eslint-disable react-hooks/exhaustive-deps */
  const rootFolders = useMemo(() => hydrated ? getRootFolders() : [], [folders, hydrated])
  const activeNotes = useMemo(() => hydrated ? getActiveNotes() : [], [notes, hydrated])
  const deletedNotes = useMemo(() => hydrated ? getDeletedNotes() : [], [notes, hydrated])
  const deletedFolders = useMemo(() => hydrated ? getDeletedFolders() : [], [folders, hydrated])
  const recentNotes = useMemo(() => hydrated ? getRecentNotes(10) : [], [notes, hydrated])
  /* eslint-enable react-hooks/exhaustive-deps */

  // Reconstruct the deleted-folder hierarchy for the synthetic ".trash"
  // view. buildTrashTree nests deleted notes under their (deleted) parent
  // folders and surfaces loose notes (no deleted parent) at the trash
  // root — see src/utils/trashTree.ts. Read-only: it never mutates state.
  const trashTree = useMemo(
    () => buildTrashTree(deletedNotes, deletedFolders),
    [deletedNotes, deletedFolders],
  )

  // Tags are derived from #word patterns in note bodies — recomputed when
  // notes change. No more entity store.
  const tagCounts = useMemo(() => collectAllTags(activeNotes), [activeNotes])

  // progressive-clone: how many notes are still SHELLS (body streaming in from
  // a first clone). Drives the subtle "N notes loading…" banner so the user
  // knows the vault is still populating. Counts down to 0 as bodies land, then
  // the banner disappears.
  const shellCount = useMemo(
    () => activeNotes.reduce((n, note) => n + (note.contentLoaded === false ? 1 : 0), 0),
    [activeNotes],
  )

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

  // Bulk delete via the existing DeleteConfirmModal (extended to handle
  // a bulk payload). Setting `confirmBulkDelete` (default true) gates the
  // modal — when false the action runs immediately. Either way, it uses
  // the in-app modal not window.confirm so popup-blockers + tab-hidden
  // dialogs can't trap the user.
  const confirmBulkDelete = useSettingsStore(s => s.confirmBulkDelete)
  const openModal = useUIStore(s => s.openModal)
  const deleteSelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (confirmBulkDelete) {
      openModal({ type: 'delete', data: { type: 'bulk', ids } })
      // The modal calls deleteNotes() itself + closes. Clear our local
      // selection now so the bar dismisses immediately and the user
      // doesn't see stale "47 selected" while reviewing the confirm.
      clearSelection()
      return
    }
    useNoteStore.getState().deleteNotes(ids)
    clearSelection()
  }

  // Global Esc handler — clears a pending compare source so the highlight
  // doesn't linger. Listening on window means the shortcut works from
  // anywhere (editor, sidebar, etc.) the way VS Code's compare flow does.
  useEffect(() => {
    if (!compareSourceNoteId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      clearCompareSource()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [compareSourceNoteId, clearCompareSource])

  // Global Delete / Backspace handler. The per-tree onKeyDown only fires
  // when the tree itself has focus — after clicking a note row, focus
  // often jumps elsewhere (editor, body), so the key shortcut wouldn't
  // fire. Listening on window means the shortcut works regardless. We
  // gate on selectedIds.size > 0 + skip when typing in inputs so we
  // don't hijack normal keystrokes.
  useEffect(() => {
    if (selectedIds.size === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      deleteSelected()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // deleteSelected closes over selectedIds; rebind whenever it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds])

  // ── Single vs double click on a note ────────────────────────────────────
  // Single click = open as preview (italic, replaceable). Double click =
  // PIN (permanent, non-italic). VS Code's explorer behaviour.
  //
  // We do NOT rely on the DOM `dblclick` event here. In the real app a
  // genuine double-click is only emitted by the browser when two clicks
  // land within the OS double-click threshold AND the pointer barely moves;
  // a slightly slow / deliberate double-click (common on trackpads and for
  // many users) fires two separate `click`s with NO `dblclick`. The old
  // code opened a preview on the first click's 200ms timer and relied on a
  // later `dblclick` to promote it — when that `dblclick` never arrived the
  // tab was stuck as a replaceable preview, so a following single-click on
  // another note replaced it. That is the reported "double click is not
  // working" bug.
  //
  // Fix: detect the double-click ourselves by counting clicks on the SAME
  // note within `DOUBLE_CLICK_MS`. The first click arms a delayed preview
  // open; a second click within the window cancels that timer and pins
  // instead (openNote with preview:false both opens a fresh pinned tab and
  // promotes an already-open preview tab — see workspaceStore.openNote).
  // The `onDoubleClick` handler is kept only as a redundant fast-path for
  // the native event and routes through the same pin logic, so a real
  // browser dblclick and a self-detected one converge on one outcome.
  //
  // When the click originates from a non-tree view (Recent/Tags/etc.) we
  // also call revealNote so the user sees where the note lives. Reveal
  // switches the current view to 'notes' as a side-effect.
  const DOUBLE_CLICK_MS = 350
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastClickRef = useRef<{ id: string; at: number } | null>(null)

  // Promote the note to a pinned tab. Shared by the self-detected
  // double-click and the native onDoubleClick fast-path. Cancels any
  // pending single-click preview so the note never sticks as a preview.
  const pinNote = (id: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    lastClickRef.current = null
    const fromNonTreeView = currentView !== 'notes' && currentView !== 'trash'
    openNote(id, { preview: false })
    if (fromNonTreeView) revealNote(id)
    closeDrawerIfMobile()
  }

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
      lastClickRef.current = null
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
      lastClickRef.current = null
      return
    }

    // ── Self-detected double-click ────────────────────────────────────────
    // A second plain click on the SAME note within the window pins it,
    // regardless of whether the browser also emits a native `dblclick`.
    const now = Date.now()
    const prev = lastClickRef.current
    if (prev && prev.id === id && now - prev.at <= DOUBLE_CLICK_MS) {
      pinNote(id)
      return
    }
    lastClickRef.current = { id, at: now }

    // Plain (first) click: clear the selection (so the user knows multi-mode
    // ended) + open the note as preview after the double-click guard. If a
    // second click lands within the window the timer is cancelled above.
    if (selectedIds.size > 0) clearSelection()
    lastClickedIdRef.current = id
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      openNote(id, { preview: true })
      if (fromNonTreeView) revealNote(id)
      // Mobile: dismiss the off-canvas drawer once the note is open
      // (the user wants the editor next, not the file tree).
      closeDrawerIfMobile()
      clickTimerRef.current = null
      lastClickRef.current = null
    }, DOUBLE_CLICK_MS)
  }
  const handleNoteDoubleClick = (id: string) => {
    // Native dblclick fast-path. Most genuine fast double-clicks fire this;
    // the self-detected counter in handleNoteClick covers the rest. Both
    // route through pinNote so the outcome is identical.
    pinNote(id)
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
          closeDrawerIfMobile()
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
      case 'F2': {
        // F2 = inline rename of the focused row (notes and folders).
        // Mirrors the right-click → Rename action; both route through
        // uiStore.requestRename, which the matching EditableText watches.
        if (!currentRow) return
        if (currentRow.kind !== 'note' && currentRow.kind !== 'folder') return
        e.preventDefault()
        useUIStore.getState().requestRename({ type: currentRow.kind, id: currentRow.id })
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
  }, [flattenedRows, focusedRow, expandedFolders, toggleFolderExpanded, openNote, moveFocusToIndex, closeDrawerIfMobile])

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
    beginFolderDrag,
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

  const AttachmentItem = ({ m, depth = 0 }: { m: AttachmentMeta; depth?: number }) => (
    <div
      className="obsidian-file-item"
      draggable
      onDragStart={e => beginAttachmentDrag(e, m.path)}
      onDragEnd={endDrag}
      onClick={() => openAttachment(m.path)}
      title={m.path}
      data-testid="attachment-row"
      data-attachment-path={m.path}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={false}
    >
      <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="flex-1 truncate">{attachmentDisplayName(m.path)}</span>
    </div>
  )

  // Render note item
  const NoteItem = ({ note, className = '', depth = 0 }: { note: typeof notes[0]; className?: string; depth?: number }) => {
    const kbFocused = isRowFocused('note', note.id)
    const multiSelected = isSelected(note.id)
    const isCompareSource = compareSourceNoteId === note.id
    const isActive = selectedNoteId === note.id || multiSelected
    // Mobile-only drag-to-pin. Trash rows are excluded because their
    // primary affordance is restore / permanently delete.
    const swipeEnabled = isMobile && currentView !== 'trash' && !note.isDeleted
    return (
      <SwipePinRow
        enabled={swipeEnabled}
        onPinToggle={() => togglePinNote(note.id)}
      >
        <div
          className={`obsidian-file-item ${
            multiSelected ? 'bg-obsidianAccentPurple/25 border-l-2 border-obsidianAccentPurple -ml-[2px] pl-[10px]' :
              selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
          } ${kbFocused ? 'ring-1 ring-inset ring-obsidianAccentPurple' : ''} ${
            isCompareSource ? 'italic border-l-2 border-obsidianAccentPurple -ml-[2px] pl-[10px] ring-1 ring-inset ring-obsidianAccentPurple/60' : ''
          } ${className}`}
          data-compare-source={isCompareSource ? 'true' : undefined}
          draggable={currentView !== 'trash' && !multiSelected && !note.isDeleted}
          onDragStart={e => beginNoteDrag(e, note.id)}
          onDragEnd={endDrag}
          onClick={(e) => handleNoteClick(note.id, e)}
          onDoubleClick={() => handleNoteDoubleClick(note.id)}
          onContextMenu={e => onRightClick(e, 'note', note.id)}
          tabIndex={-1}
          data-testid="note-row"
          data-note-id={note.id}
          data-kb-focused={kbFocused ? 'true' : undefined}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={isActive}
          aria-current={kbFocused ? 'true' : undefined}
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
      </SwipePinRow>
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
      <div className="mb-0.5" role="treeitem" aria-level={depth + 1} aria-expanded={isExpanded} aria-selected={isActive} aria-current={kbFocused ? 'true' : undefined}>
        <div
          className={`obsidian-folder-item ${
            isActive ? 'bg-obsidianHighlight' : ''
          } ${isDropTarget ? 'outline outline-2 outline-obsidianAccentPurple bg-obsidianAccentPurple/10' : ''} ${
            kbFocused ? 'ring-1 ring-inset ring-obsidianAccentPurple' : ''
          }`}
          style={{ paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : undefined }}
          draggable={currentView !== 'trash'}
          onDragStart={e => beginFolderDrag(e, folder.id)}
          onDragEnd={endDrag}
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
          <div role="group">
            {/* Nested child folders first */}
            {childFolders.map(child => (
              <FolderItem key={child.id} folder={child} depth={depth + 1} />
            ))}
            {/* Then notes + attachments inside this folder */}
            <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              {folderNotes.map(note => (
                <NoteItem key={note.id} note={note} depth={depth + 1} />
              ))}
              {folderAttachments.map(m => (
                <AttachmentItem key={m.path} m={m} depth={depth + 1} />
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
          <div role="tree" aria-label="Trash">
          {deletedNotes.map(note => (
            <div
              key={note.id}
              className={`obsidian-file-item ${
                selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
              }`}
              onClick={() => handleNoteClick(note.id)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
              role="treeitem"
              aria-level={1}
              aria-selected={selectedNoteId === note.id}
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
          ))}
          </div>
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
          <div role="tree" aria-label="Recently modified notes">
            {recentNotes.map(note => (
              <NoteItem key={note.id} note={note} />
            ))}
          </div>
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

  // Empty-state only fires when EVERYTHING is empty — including the
  // .trash bucket. Previously this branch returned before
  // TrashSyntheticFolder rendered, so a user who deleted their last
  // note lost access to their trash (the synthetic folder vanished
  // with the rest of the tree). Caught by qa-tester sweep 2026-05-21.
  if (
    rootFolders.length === 0 &&
    rootNotes.length === 0 &&
    attachmentMeta.length === 0 &&
    deletedNotes.length === 0
  ) {
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
      {shellCount > 0 && (
        <div
          className="mb-1 flex items-center gap-2 px-2 py-1.5 text-xs text-obsidianSecondaryText"
          data-testid="shell-loading-banner"
        >
          <span className="inline-block w-3 h-3 border-2 border-obsidianSecondaryText/30 border-t-obsidianAccentPurple rounded-full animate-spin" />
          {shellCount} {shellCount === 1 ? 'note' : 'notes'} loading…
        </div>
      )}
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
      {/* Synthetic ".trash" folder at the top of the root list when
          there are deleted notes. Renders as a normal-looking folder
          row + normal NoteItem children — no special inline buttons.
          Right-click → standard context menu (restore/delete-forever
          come from there, not from the row). */}
      {deletedNotes.length > 0 && (
        <TrashSyntheticFolder
          trashTree={trashTree}
          name={trashFolderName}
          deletedCount={deletedNotes.length}
          expanded={!!expandedFolders[TRASH_FOLDER_ID]}
          onToggle={() => toggleFolderExpanded(TRASH_FOLDER_ID)}
          onContextMenu={e => onRightClick(e, 'folder', TRASH_FOLDER_ID)}
          expandedFolders={expandedFolders}
          toggleFolderExpanded={toggleFolderExpanded}
          onFolderRightClick={(e, id) => onRightClick(e, 'folder', id)}
          renderNote={(note) => <NoteItem key={note.id} note={note} />}
        />
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

// One deleted FOLDER inside the .trash view, rendered recursively so the
// pre-deletion shape is preserved: deleted child folders nest under it and
// its deleted notes sit at the bottom. Expansion piggy-backs on
// folderStore.expandedFolders keyed by the folder's REAL id, so the row
// behaves like a normal folder. Right-click routes through the shared
// ContextMenu with the real folder id, where the trashed-folder branch
// offers Restore / Permanently Delete.
interface TrashFolderRowProps {
  node: TrashFolderNode
  depth: number
  expandedFolders: Record<string, boolean>
  toggleFolderExpanded: (id: string) => void
  onFolderRightClick: (e: React.MouseEvent, id: string) => void
  renderNote: (note: Note) => React.ReactNode
}

const TrashFolderRow = ({
  node, depth, expandedFolders, toggleFolderExpanded, onFolderRightClick, renderNote,
}: TrashFolderRowProps) => {
  const expanded = !!expandedFolders[node.folder.id]
  const childCount = node.childFolders.length + node.notes.length
  return (
    <div
      className="mb-0.5"
      data-testid="trash-folder-row"
      data-folder-id={node.folder.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expanded}
      aria-selected={false}
    >
      <div
        className="obsidian-folder-item"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => toggleFolderExpanded(node.folder.id)}
        onContextMenu={e => onFolderRightClick(e, node.folder.id)}
        data-folder-name={node.folder.name}
      >
        <button
          type="button"
          className="mr-1 focus:outline-none"
          onClick={e => { e.stopPropagation(); toggleFolderExpanded(node.folder.id) }}
          aria-label={expanded ? `Collapse ${node.folder.name}` : `Expand ${node.folder.name}`}
        >
          {expanded ? (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronRightIcon className="w-3.5 h-3.5" />
          )}
        </button>
        <FolderIcon className="w-4 h-4 mr-1.5 flex-shrink-0 text-obsidianSecondaryText" />
        <span className="flex-1 truncate">{node.folder.name}</span>
        {childCount > 0 && (
          <span className="text-[10px] text-obsidianSecondaryText ml-1">{childCount}</span>
        )}
      </div>
      {expanded && (
        <div role="group">
          {node.childFolders.map(child => (
            <TrashFolderRow
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              toggleFolderExpanded={toggleFolderExpanded}
              onFolderRightClick={onFolderRightClick}
              renderNote={renderNote}
            />
          ))}
          <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
            {node.notes.map(note => renderNote(note))}
          </div>
        </div>
      )}
    </div>
  )
}

// Pseudo-folder rendered at the top of the file tree when there are
// soft-deleted notes. It LOOKS like any other folder: chevron + folder
// icon + name + count, expandable. Its children now reconstruct the
// pre-deletion hierarchy — deleted folders nest (via TrashFolderRow) with
// their deleted notes inside, while loose deleted notes (no deleted
// parent) render flat at the top, matching the old behaviour. Restore /
// delete-forever live in the right-click context menu, never inline. The
// .trash expand-state piggy-backs on folderStore.expandedFolders under the
// reserved id "__trash__".
interface TrashSyntheticFolderProps {
  trashTree: ReturnType<typeof buildTrashTree>
  // Configurable display name for the synthetic trash row (Settings →
  // Vault). Cosmetic only — the row's identity stays TRASH_FOLDER_ID.
  name: string
  deletedCount: number
  expanded: boolean
  onToggle: () => void
  // Right-click handler for the .trash row — wires it into the same
  // ContextMenu real folders use, so the BROWSER menu never shows. The
  // handler preventDefaults; the menu special-cases TRASH_FOLDER_ID to
  // show only "Empty Trash".
  onContextMenu: (e: React.MouseEvent) => void
  expandedFolders: Record<string, boolean>
  toggleFolderExpanded: (id: string) => void
  onFolderRightClick: (e: React.MouseEvent, id: string) => void
  renderNote: (note: Note) => React.ReactNode
}

const TrashSyntheticFolder = ({
  trashTree, name, deletedCount, expanded, onToggle, onContextMenu,
  expandedFolders, toggleFolderExpanded, onFolderRightClick, renderNote,
}: TrashSyntheticFolderProps) => {
  return (
    <div
      className="mb-0.5"
      data-testid="trash-synthetic-folder"
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      aria-selected={false}
    >
      <div
        className="obsidian-folder-item"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        data-folder-id={TRASH_FOLDER_ID}
        data-folder-name={name}
      >
        <button
          type="button"
          className="mr-1 focus:outline-none"
          onClick={e => { e.stopPropagation(); onToggle() }}
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
        >
          {expanded ? (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronRightIcon className="w-3.5 h-3.5" />
          )}
        </button>
        <FolderIcon className="w-4 h-4 mr-1.5 flex-shrink-0" />
        <span className="flex-1 truncate">{name}</span>
        <span className="text-[10px] text-obsidianSecondaryText ml-1">
          {deletedCount}
        </span>
      </div>
      {expanded && (
        <div role="group">
          {/* Deleted folders, nested with their deleted contents. */}
          {trashTree.rootFolders.map(node => (
            <TrashFolderRow
              key={node.folder.id}
              node={node}
              depth={1}
              expandedFolders={expandedFolders}
              toggleFolderExpanded={toggleFolderExpanded}
              onFolderRightClick={onFolderRightClick}
              renderNote={renderNote}
            />
          ))}
          {/* Loose deleted notes (no deleted parent folder) — flat. */}
          {trashTree.looseNotes.map(note => renderNote(note))}
        </div>
      )}
    </div>
  )
}

export default FolderTree
