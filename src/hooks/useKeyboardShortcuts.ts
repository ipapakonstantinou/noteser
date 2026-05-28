'use client'

import { useEffect, useCallback } from 'react'
import { useUIStore, useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { KEYBOARD_SHORTCUTS } from '@/types'
import {
  SHORTCUTS,
  activeComboFor,
  matchEvent,
  parseCombo,
  type ShortcutAction,
} from '@/utils/shortcuts'

interface ShortcutHandlers {
  onInsertNumberedList?: () => void
  onInsertTodo?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

// Actions that are safe to fire even when focus is in an INPUT/TEXTAREA/
// contenteditable. Everything else is suppressed while typing so we don't
// hijack ordinary keystrokes inside the editor.
const ALLOWED_IN_INPUT: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>([
  'openSearch',
  'openCommandPalette',
  // Close-tab must work while the cursor is in the editor too — that's the
  // common case (you close the note you're editing). Its Alt+W combo isn't a
  // normal typing keystroke, so allowing it in inputs is safe.
  'closeTab',
])

export const useKeyboardShortcuts = (handlers: ShortcutHandlers = {}) => {
  const { openSearch, toggleSidebar, togglePreview, openModal } = useUIStore()
  const { selectedNoteId, deleteNote } = useNoteStore()
  // Subscribing here means the hook reruns and re-binds when overrides change,
  // so a freshly-saved override takes effect without a page reload.
  const shortcutOverrides = useSettingsStore(s => s.shortcutOverrides)

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger most shortcuts when typing in inputs (we still allow a
    // small allowlist, e.g. openSearch / Ctrl+K, to fire from the editor).
    const target = event.target as HTMLElement
    const isInput = target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable

    const hasCtrl = event.ctrlKey || event.metaKey
    const hasShift = event.shiftKey

    // ── Data-driven app shortcuts ─────────────────────────────────────────
    // Walk the SHORTCUTS list, picking the first def whose active combo
    // (default OR user override) matches the event. We do this BEFORE the
    // hard-coded editor/Escape branches so user overrides can target any key
    // — including keys that used to be handled by the legacy ladder.
    for (const def of SHORTCUTS) {
      const combo = parseCombo(activeComboFor(def, shortcutOverrides))
      if (!matchEvent(combo, event)) continue
      if (isInput && !ALLOWED_IN_INPUT.has(def.action)) continue

      switch (def.action) {
        case 'newNote': {
          event.preventDefault()
          const note = useNoteStore.getState().addNote({ folderId: null })
          useWorkspaceStore.getState().openNote(note.id, { preview: false })
          return
        }
        case 'openSearch':
          event.preventDefault()
          openSearch()
          return
        case 'toggleSidebar':
          event.preventDefault()
          toggleSidebar()
          return
        case 'togglePreview':
          event.preventDefault()
          togglePreview()
          return
        case 'newFolder':
          event.preventDefault()
          useFolderStore.getState().addFolder({ parentId: null })
          return
        case 'deleteNote': {
          if (!selectedNoteId) return
          event.preventDefault()
          openModal({
            type: 'delete',
            data: { type: 'note', id: selectedNoteId },
          })
          return
        }
        case 'openToday':
          event.preventDefault()
          // Lazy import keeps the keyboard hook free of a hard daily-notes dep.
          import('@/utils/dailyNotes').then(({ openTodayNote }) => openTodayNote())
          return
        case 'openRandomNote':
          event.preventDefault()
          // Lazy import — keeps the random-note util out of the main bundle
          // for users who never bind / trigger this shortcut.
          import('@/utils/randomNote').then(({ openRandomNote }) => openRandomNote())
          return
        case 'focusSidebar': {
          event.preventDefault()
          // Hand focus to the sidebar folder tree if it's mounted. We
          // intentionally do NOT auto-expand the sidebar — if the user
          // collapsed it, this shortcut becomes a no-op rather than a
          // surprising layout shift.
          const tree = document.querySelector<HTMLElement>('[data-testid="folder-tree"]')
          tree?.focus()
          return
        }
        case 'openCommandPalette':
          event.preventDefault()
          openModal({ type: 'command-palette' })
          return
        case 'closeTab': {
          event.preventDefault()
          // Find the active tab across all panes and close it. No-op
          // when nothing is open. We close the global "active" tab —
          // whichever pane has activePaneId.
          const ws = useWorkspaceStore.getState()
          const pane = ws.panes.find(p => p.id === ws.activePaneId) ?? ws.panes[0]
          if (!pane || !pane.activeTabId) return
          ws.closeTab(pane.activeTabId)
          return
        }
        case 'openSettings':
          event.preventDefault()
          openModal({ type: 'settings' })
          return
      }
    }

    // ── Hard-coded shortcuts (not yet user-rebindable) ────────────────────

    // Back / Forward through the active pane's note history — Obsidian
    // defaults (Alt+Left / Alt+Right). Fires regardless of focus (Obsidian
    // navigates even while the editor is focused); Alt+Arrow isn't a
    // text-editing combo so this doesn't clobber typing.
    if (event.altKey && !hasCtrl && !hasShift && event.key === 'ArrowLeft') {
      event.preventDefault()
      useWorkspaceStore.getState().goBack()
      return
    }
    if (event.altKey && !hasCtrl && !hasShift && event.key === 'ArrowRight') {
      event.preventDefault()
      useWorkspaceStore.getState().goForward()
      return
    }

    // Show shortcuts modal - Ctrl+/
    if (hasCtrl && event.key === '/') {
      event.preventDefault()
      openModal({ type: 'shortcuts' })
      return
    }

    // `/` (no modifiers, outside of an input) is a fast synonym for
    // Ctrl+K — Obsidian / Slack muscle memory. Kept out of SHORTCUTS
    // because the combo parser refuses bare keys (would shadow typing
    // anywhere). The isInput guard below means it can't fire while
    // typing in the editor or a rename field.
    if (!hasCtrl && !hasShift && !event.altKey && event.key === '/' && !isInput) {
      event.preventDefault()
      openSearch()
      return
    }

    // Editor-only formatting shortcuts (fire only when in an editable field).
    if (isInput) {
      if (hasCtrl && hasShift) {
        if (event.key === '7') {
          event.preventDefault()
          handlers.onInsertNumberedList?.()
          return
        }
        if (event.key.toLowerCase() === 't') {
          event.preventDefault()
          handlers.onInsertTodo?.()
          return
        }
      }
      return
    }

    // Undo - Ctrl+Z
    if (hasCtrl && !hasShift && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      handlers.onUndo?.()
      return
    }

    // Redo - Ctrl+Shift+Z
    if (hasCtrl && hasShift && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      handlers.onRedo?.()
      return
    }

    // Escape - close modals / search / context menu.
    if (event.key === 'Escape') {
      useUIStore.getState().closeSearch()
      useUIStore.getState().closeModal()
      useUIStore.getState().closeContextMenu()
    }
    // deleteNote is referenced via useNoteStore.getState() inside the
    // handler — it stays in deps as a trigger but isn't read directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    openSearch,
    toggleSidebar,
    togglePreview,
    openModal,
    selectedNoteId,
    deleteNote,
    handlers,
    shortcutOverrides,
  ])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { shortcuts: KEYBOARD_SHORTCUTS }
}
