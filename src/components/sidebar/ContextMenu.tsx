'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TrashIcon,
  DocumentDuplicateIcon,
  FolderArrowDownIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  PencilSquareIcon,
  StarIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  SparklesIcon,
  ArrowUturnLeftIcon,
  ClockIcon,
  ShareIcon,
  ArrowsRightLeftIcon,
  EyeIcon,
  ArrowTopRightOnSquareIcon,
  SignalIcon,
  SignalSlashIcon,
} from '@heroicons/react/24/outline'
import { getConfiguredUrl } from '@/hooks/useCollaboration'
import { useActiveCollabStore } from '@/stores/activeCollabStore'
import { revealNote } from '@/utils/revealNote'
import { useShallow } from 'zustand/react/shallow'
import { useNoteStore, useFolderStore, useUIStore, useWorkspaceStore, useSettingsStore, useGitHubStore } from '@/stores'
import type { ContextMenuState, Folder } from '@/types'
import { AI_ACTIONS } from '@/utils/aiActions'
import { runNoteAIAction } from '@/utils/runNoteAIAction'
import { TRASH_FOLDER_ID } from '@/utils/systemFolder'
import { buildTrashTree, collectTrashFolderIds, collectTrashNoteIds } from '@/utils/trashTree'

// Build a flat list of folders annotated with their full path
// ("Parent / Child / Leaf"), in tree order.
function flattenFolders(folders: Folder[]): Array<{ id: string; path: string }> {
  const byParent = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const key = f.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  for (const [, kids] of byParent) kids.sort((a, b) => a.order - b.order)

  const out: Array<{ id: string; path: string }> = []
  const walk = (parentId: string | null, prefix: string) => {
    const kids = byParent.get(parentId) ?? []
    for (const f of kids) {
      const path = prefix ? `${prefix} / ${f.name}` : f.name
      out.push({ id: f.id, path })
      walk(f.id, path)
    }
  }
  walk(null, '')
  return out
}

interface ContextMenuProps {
  contextMenu: NonNullable<ContextMenuState>
  onClose: () => void
}

export const ContextMenu = ({ contextMenu, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const openModal = useUIStore(s => s.openModal)
  const requestRename = useUIStore(s => s.requestRename)
  const {
    getNoteById,
    addNote,
    duplicateNote,
    togglePinNote,
    deleteNote,
    restoreNote,
    restoreNotes,
    getDeletedNotes,
  } = useNoteStore(
    useShallow(s => ({
      getNoteById: s.getNoteById,
      addNote: s.addNote,
      duplicateNote: s.duplicateNote,
      togglePinNote: s.togglePinNote,
      deleteNote: s.deleteNote,
      restoreNote: s.restoreNote,
      restoreNotes: s.restoreNotes,
      getDeletedNotes: s.getDeletedNotes,
    }))
  )
  const {
    getFolderById,
    addFolder,
    deleteFolder,
    getActiveFolders,
    getDeletedFolders,
    restoreFolders,
    toggleFolderExpanded,
    expandedFolders,
  } = useFolderStore(
    useShallow(s => ({
      getFolderById: s.getFolderById,
      addFolder: s.addFolder,
      deleteFolder: s.deleteFolder,
      getActiveFolders: s.getActiveFolders,
      getDeletedFolders: s.getDeletedFolders,
      restoreFolders: s.restoreFolders,
      toggleFolderExpanded: s.toggleFolderExpanded,
      expandedFolders: s.expandedFolders,
    }))
  )
  const openNote = useWorkspaceStore(s => s.openNote)
  const openCompare = useWorkspaceStore(s => s.openCompare)
  // VS Code-style compare flow: a previously right-clicked note may be
  // pending as the "left" side. Reading the id here (not the action) so
  // both Select for Compare and Compare with Selected stay in sync.
  const compareSourceNoteId = useUIStore(s => s.compareSourceNoteId)
  const setCompareSource = useUIStore(s => s.setCompareSource)
  const clearCompareSource = useUIStore(s => s.clearCompareSource)
  // "Publish as gist" reuses the GitHub OAuth token. Hooked up here at
  // the top of the component so it sits BEFORE the early `if (!item)
  // return` below — react-hooks/rules-of-hooks won't accept a hook
  // call after an early return.
  const hasGithubToken = useGitHubStore(s => Boolean(s.token))
  const isGitHubHost = useGitHubStore(s => s.host === 'github')

  const isNote = contextMenu.type === 'note'
  // The synthetic ".trash" sidebar folder uses a reserved id and is NOT a
  // real Folder entity — getFolderById returns undefined for it. Detect it
  // up front so we can render a trash-only menu ("Empty Trash") and skip
  // the normal folder actions (New note / Rename / cascade Delete).
  const isTrashFolder = !isNote && contextMenu.id === TRASH_FOLDER_ID
  const item = isNote
    ? getNoteById(contextMenu.id)
    : getFolderById(contextMenu.id)

  // A real, soft-deleted folder right-clicked inside the .trash view. Its
  // backing Folder entity still exists (isDeleted:true), so getFolderById
  // returns it — but the normal folder menu (New note / Rename / cascade
  // Delete) is wrong here. We show Restore / Permanently Delete instead,
  // both operating on the whole reconstructed subtree.
  const isTrashedFolder =
    !isNote && !isTrashFolder && !!item && 'isDeleted' in item && item.isDeleted

  const folders = getActiveFolders()
  const folderPaths = useMemo(() => flattenFolders(folders), [folders])

  // Submenu state for "Move to folder" — click-toggle, not CSS hover.
  const [movePanelOpen, setMovePanelOpen] = useState(false)
  const [moveSearch, setMoveSearch] = useState('')
  // AI submenu — same click-toggle pattern.
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  // AI is gated on having a provider configured; we hide the entry
  // entirely when off so users don't see a non-functional option.
  const aiProvider = useSettingsStore(s => s.aiProvider)
  const aiAvailable = aiProvider !== 'off'

  // Per-note "Go live" toggle (mirrors the EditorFooter LiveCollabToggle, but
  // operates on the RIGHT-CLICKED note, not necessarily the open one). Shown
  // only when collaborationMode === 'per-note' AND the transport is configured.
  // In 'off'/'repo' modes there is nothing meaningful to toggle per note.
  const collaborationMode = useSettingsStore(s => s.collaborationMode)
  const toggleCollab = useActiveCollabStore(s => s.toggle)
  const collabActive = useActiveCollabStore(s =>
    isNote ? s.activeNoteIds.has(contextMenu.id) : false,
  )
  const collabAvailable =
    isNote && collaborationMode === 'per-note' && getConfiguredUrl() != null
  const filteredFolderPaths = useMemo(() => {
    const q = moveSearch.trim().toLowerCase()
    if (!q) return folderPaths
    return folderPaths.filter(f => f.path.toLowerCase().includes(q))
  }, [folderPaths, moveSearch])

  // When the menu re-anchors (different right-click), close any open submenu.
  useEffect(() => {
    setMovePanelOpen(false)
    setMoveSearch('')
    setAiPanelOpen(false)
  }, [contextMenu])

  // Position menu to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()

    // Adjust if menu goes off right edge
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`
    }

    // Adjust if menu goes off bottom edge
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`
    }
  }, [contextMenu])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Trash-only menu. Rendered before the `if (!item) return null` guard
  // because the synthetic ".trash" folder has no backing Folder entity
  // (item is undefined for it). Shows ONLY "Empty Trash", routed through
  // the DeleteConfirmModal's "Empty Trash?" flow which hard-deletes the
  // soft-deleted notes and never touches deletedFolderPaths.
  if (isTrashFolder) {
    const handleEmptyTrash = () => {
      openModal({
        type: 'delete',
        data: { type: 'folder', id: TRASH_FOLDER_ID },
      })
      onClose()
    }
    return (
      <div
        ref={menuRef}
        className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        role="menu"
        data-testid="context-menu"
      >
        <button
          onClick={handleEmptyTrash}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-red-400 hover:bg-red-900/30"
          data-testid="context-menu-empty-trash"
        >
          <TrashIcon className="w-4 h-4" />
          Empty Trash
        </button>
      </div>
    )
  }

  if (!item) return null

  // foreign-vault-files: a note with `kind: 'foreign'` is a read-only mirror
  // of a remote vault file (e.g. `.canvas`, `.base`) — Rename / Delete /
  // Duplicate / Pin all make no sense (we cannot edit the file). Render a
  // short menu with Reveal in folder (sidebar focus) and Show on GitHub
  // (open the raw file in a new tab) so the user can still find or inspect
  // the file. Everything destructive is excluded by design.
  const isForeignNote = isNote && (item as { kind?: string }).kind === 'foreign'
  if (isForeignNote) {
    const foreignNote = item as { gitPath?: string | null }
    const { token, syncRepo } = useGitHubStore.getState()
    const gitPath = foreignNote.gitPath ?? null
    const githubUrl = syncRepo && gitPath
      ? `https://github.com/${syncRepo.owner}/${syncRepo.name}/blob/${syncRepo.branch}/${gitPath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      : null
    const handleReveal = () => {
      revealNote(contextMenu.id)
      onClose()
    }
    const handleShowOnGitHub = () => {
      if (githubUrl) window.open(githubUrl, '_blank', 'noopener')
      onClose()
    }
    // We hide Show on GitHub when we don't have a repo to link to (e.g. the
    // user hasn't connected GitHub yet). The Reveal action stays available
    // because it works purely against local state. `token` is read so a
    // future enhancement can gate features that need an authenticated
    // request, but currently the URL is public-readable so we don't depend
    // on it here.
    void token
    // MenuButton is declared further down the function body so we inline the
    // two buttons here instead of forward-referencing it. The styling matches
    // MenuButton verbatim to keep the menu consistent with the other entries.
    return (
      <div
        ref={menuRef}
        className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        role="menu"
        data-testid="context-menu"
      >
        <button
          onClick={handleReveal}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight transition-colors"
          data-testid="context-menu-foreign-reveal"
        >
          <EyeIcon className="w-4 h-4" />
          Reveal in folder
        </button>
        {githubUrl && (
          <button
            onClick={handleShowOnGitHub}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight transition-colors"
            data-testid="context-menu-foreign-github"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            Show on GitHub
          </button>
        )}
      </div>
    )
  }

  // Note-only: is the right-clicked note in the trash? Drives the
  // Restore option visibility — and we hide the rest of the note
  // actions for trashed items since most don't make sense (you
  // can't pin or duplicate a trashed row from here).
  const isTrashedNote = isNote && item && 'isDeleted' in item && item.isDeleted

  const handleDelete = () => {
    // Single-note soft-delete only: honour the "Confirm before moving
    // notes to trash" toggle. Folders, trashed notes (PERMANENT delete),
    // and hardDelete mode all keep their confirm because they're either
    // irreversible or cascade-y enough to be worth a second look.
    const { confirmBeforeTrash, trashMode } = useSettingsStore.getState()
    const isSingleNoteSoftDelete =
      isNote && !isTrashedNote && trashMode !== 'hardDelete'
    if (isSingleNoteSoftDelete && !confirmBeforeTrash) {
      deleteNote(contextMenu.id)
      onClose()
      return
    }
    openModal({
      type: 'delete',
      // A trashed note's "Delete" means PERMANENTLY delete (it's already
      // in the trash) — pass permanent so the modal calls
      // permanentlyDeleteNote instead of soft-deleting it again (which
      // would be a no-op and is the "delete-in-trash doesn't work" bug).
      data: { type: contextMenu.type, id: contextMenu.id, permanent: isTrashedNote || undefined }
    })
    onClose()
  }

  const handleRestore = () => {
    if (isNote) restoreNote(contextMenu.id)
    onClose()
  }

  // Resolve the trashed-folder subtree node (this folder + its deleted
  // descendant folders + their deleted notes) by reconstructing the trash
  // tree and finding the node for this folder id. Returns null if the
  // folder isn't found in the reconstructed tree (e.g. it had no trashed
  // contents — though such a shell folder wouldn't surface a row to
  // right-click in the first place). Searches recursively because a
  // deleted SUBfolder nests under its deleted parent in the tree.
  const findTrashSubtree = () => {
    const tree = buildTrashTree(getDeletedNotes(), getDeletedFolders())
    const stack = [...tree.rootFolders]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.folder.id === contextMenu.id) return node
      stack.push(...node.childFolders)
    }
    return null
  }

  const handleRestoreFolder = () => {
    const node = findTrashSubtree()
    if (node) {
      // Restore the folder subtree FIRST so the notes' folderIds resolve
      // to live folders, then bring the notes back. restoreNotes skips the
      // root-fallback that single restoreNote applies, so notes land back
      // inside their (now-restored) folders.
      restoreFolders(collectTrashFolderIds(node))
      restoreNotes(collectTrashNoteIds(node))
    } else {
      // Fallback: at least revive the folder entity itself.
      useFolderStore.getState().restoreFolder(contextMenu.id)
    }
    onClose()
  }

  const handlePermanentlyDeleteFolder = () => {
    // Route through the confirm modal so a folder full of notes isn't
    // nuked on a single mis-click. The modal's trashed-folder branch
    // collects the same subtree and hard-deletes folders + notes.
    openModal({
      type: 'delete',
      data: { type: 'folder', id: contextMenu.id, permanent: true, trashed: true },
    })
    onClose()
  }

  const handleDuplicate = () => {
    if (isNote) {
      duplicateNote(contextMenu.id)
    }
    onClose()
  }

  const handleTogglePin = () => {
    if (isNote) {
      togglePinNote(contextMenu.id)
    }
    onClose()
  }

  const handleMoveToFolder = (folderId: string | null) => {
    if (isNote) {
      const { moveNoteToFolder } = useNoteStore.getState()
      moveNoteToFolder(contextMenu.id, folderId)
    }
    onClose()
  }

  const handleNewSubfolder = () => {
    if (!isNote) {
      addFolder({ parentId: contextMenu.id })
      // Make sure the parent is expanded so the user sees the new child.
      if (!expandedFolders[contextMenu.id]) toggleFolderExpanded(contextMenu.id)
    }
    onClose()
  }

  const handleRename = () => {
    requestRename({ type: contextMenu.type as 'note' | 'folder', id: contextMenu.id })
    onClose()
  }

  const handleViewHistory = () => {
    useUIStore.getState().openModal({ type: 'file-history', data: { noteId: contextMenu.id } })
    onClose()
  }
  // Only pushed notes have a meaningful history surface — guard the
  // menu item to keep the UI honest when the note has never reached
  // GitHub.
  const canViewHistory = isNote && !!(item as { gitPath?: string | null }).gitPath

  const handlePublishGist = () => {
    useUIStore.getState().openModal({ type: 'publish-gist', data: { noteId: contextMenu.id } })
    onClose()
  }

  const handleToggleCollab = () => {
    if (isNote) toggleCollab(contextMenu.id)
    onClose()
  }

  const handleSelectForCompare = () => {
    if (isNote) setCompareSource(contextMenu.id)
    onClose()
  }

  const handleCompareWithSelected = () => {
    if (isNote && compareSourceNoteId && compareSourceNoteId !== contextMenu.id) {
      openCompare(compareSourceNoteId, contextMenu.id)
      // Auto-clear once a compare opens — matches VS Code's behaviour
      // and keeps the tree highlight from lingering after the diff
      // surface is already on screen.
      clearCompareSource()
    }
    onClose()
  }

  const canCompareWithSelected =
    isNote &&
    !!compareSourceNoteId &&
    compareSourceNoteId !== contextMenu.id &&
    !isTrashedNote

  const handleNewNoteInFolder = () => {
    if (!isNote) {
      const note = addNote({ folderId: contextMenu.id })
      openNote(note.id)
      if (!expandedFolders[contextMenu.id]) toggleFolderExpanded(contextMenu.id)
    }
    onClose()
  }

  const MenuButton = ({
    icon: Icon,
    label,
    onClick,
    danger = false
  }: {
    icon: typeof TrashIcon
    label: string
    onClick: () => void
    danger?: boolean
  }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-900/30'
          : 'text-obsidianText hover:bg-obsidianHighlight'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )

  // Trashed real folder: Restore (folder + its trashed notes + deleted
  // descendant folders) and Permanently Delete (hard-delete the subtree).
  // None of the normal folder actions make sense on a tombstoned folder.
  if (isTrashedFolder) {
    return (
      <div
        ref={menuRef}
        className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        role="menu"
        data-testid="context-menu"
      >
        <MenuButton
          icon={ArrowUturnLeftIcon}
          label="Restore"
          onClick={handleRestoreFolder}
        />
        <MenuButton
          icon={TrashIcon}
          label="Permanently Delete"
          onClick={handlePermanentlyDeleteFolder}
          danger
        />
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      // Stop click propagation: the sidebar root has an onClick that
      // closes the menu on ANY click inside, which kills the
      // submenu-open state (Move to folder, AI) before it can render.
      // Items that should close the menu call onClose() directly.
      onClick={e => e.stopPropagation()}
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
      style={{
        top: contextMenu.y,
        left: contextMenu.x
      }}
      role="menu"
      data-testid="context-menu"
    >
      {!isNote && (
        <>
          <MenuButton
            icon={DocumentPlusIcon}
            label="New note in folder"
            onClick={handleNewNoteInFolder}
          />
          <MenuButton
            icon={FolderPlusIcon}
            label="New subfolder"
            onClick={handleNewSubfolder}
          />
          <MenuButton
            icon={PencilSquareIcon}
            label="Rename"
            onClick={handleRename}
          />
          <div className="my-1 border-t border-obsidianBorder" />
        </>
      )}

      {isNote && (
        <>
          {/* Restore is the only useful action on a trashed note —
              shown above the rest so it's the obvious target. The
              other note actions remain available for symmetry but
              none of them have great semantics on a trashed row;
              tightening that is a follow-up. */}
          {isTrashedNote && (
            <MenuButton
              icon={ArrowUturnLeftIcon}
              label="Restore"
              onClick={handleRestore}
            />
          )}
          <MenuButton
            icon={(item as { isPinned?: boolean }).isPinned ? StarIcon : StarIcon}
            label={(item as { isPinned?: boolean }).isPinned ? 'Unpin' : 'Pin to top'}
            onClick={handleTogglePin}
          />
          <MenuButton
            icon={PencilSquareIcon}
            label="Rename"
            onClick={handleRename}
          />
          <MenuButton
            icon={DocumentDuplicateIcon}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          {!isTrashedNote && (
            <MenuButton
              icon={ArrowsRightLeftIcon}
              label="Select for Compare"
              onClick={handleSelectForCompare}
            />
          )}
          {canCompareWithSelected && (
            <MenuButton
              icon={ArrowsRightLeftIcon}
              label="Compare with Selected"
              onClick={handleCompareWithSelected}
            />
          )}
          {collabAvailable && !isTrashedNote && (
            <MenuButton
              icon={collabActive ? SignalIcon : SignalSlashIcon}
              label={collabActive ? 'Stop live' : 'Go live'}
              onClick={handleToggleCollab}
            />
          )}
          {canViewHistory && isGitHubHost && (
            <MenuButton
              icon={ClockIcon}
              label="View history"
              onClick={handleViewHistory}
            />
          )}
          {hasGithubToken && !isTrashedNote && isGitHubHost && (
            <MenuButton
              icon={ShareIcon}
              label="Publish as gist"
              onClick={handlePublishGist}
            />
          )}

          {!movePanelOpen && (
            <button
              onClick={() => setMovePanelOpen(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            >
              <span className="flex items-center gap-2">
                <FolderArrowDownIcon className="w-4 h-4" />
                Move to folder
              </span>
              <ChevronRightIcon className="w-4 h-4 text-obsidianSecondaryText" />
            </button>
          )}

          {movePanelOpen && (
            <div className="w-full">
              <button
                onClick={() => setMovePanelOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-obsidianSecondaryText hover:bg-obsidianHighlight"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back
              </button>
              <input
                type="text"
                value={moveSearch}
                onChange={e => setMoveSearch(e.target.value)}
                placeholder="Filter folders…"
                autoFocus
                className="w-[calc(100%-1.5rem)] mx-3 my-1 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded text-xs text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
              />
              <div className="max-h-60 overflow-y-auto">
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight"
                >
                  <span className="text-obsidianSecondaryText italic">— No folder (root) —</span>
                </button>
                {filteredFolderPaths.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-obsidianSecondaryText italic">No matches</div>
                ) : (
                  filteredFolderPaths.map(({ id, path }) => (
                    <button
                      key={id}
                      onClick={() => handleMoveToFolder(id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight text-left truncate"
                      title={path}
                    >
                      {path}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {aiAvailable && (
            <>
              <div className="my-1 border-t border-obsidianBorder" />
              {!aiPanelOpen ? (
                <button
                  onClick={() => setAiPanelOpen(true)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
                  data-testid="context-menu-ai"
                >
                  <span className="flex items-center gap-2">
                    <SparklesIcon className="w-4 h-4 text-obsidianAccentPurple" />
                    AI actions
                  </span>
                  <ChevronRightIcon className="w-4 h-4 text-obsidianSecondaryText" />
                </button>
              ) : (
                <div className="w-full">
                  <button
                    onClick={() => setAiPanelOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-obsidianSecondaryText hover:bg-obsidianHighlight"
                  >
                    <ChevronLeftIcon className="w-3.5 h-3.5" />
                    Back
                  </button>
                  {AI_ACTIONS.map(action => (
                    <button
                      key={action.id}
                      onClick={() => {
                        let extra: string | undefined
                        if (action.needsExtraInput) {
                          // v1 uses native prompt() — keeps the modal
                          // story simple and works in jsdom for tests.
                          const answer = window.prompt(action.extraInputLabel ?? 'Input', action.extraInputPlaceholder ?? '')
                          if (answer == null) return
                          extra = answer
                        }
                        void runNoteAIAction({ actionId: action.id, noteId: contextMenu.id, extraInput: extra })
                        onClose()
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight text-left"
                      title={action.description}
                      data-testid={`ai-action-${action.id}`}
                    >
                      <SparklesIcon className="w-3.5 h-3.5 text-obsidianAccentPurple/70 flex-none" />
                      <span className="truncate">{action.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="my-1 border-t border-obsidianBorder" />

        </>
      )}

      <MenuButton
        icon={TrashIcon}
        label={isTrashedNote ? 'Permanently Delete' : 'Delete'}
        onClick={handleDelete}
        danger
      />
    </div>
  )
}

export default ContextMenu
