'use client'

import { useEffect, useCallback } from 'react'
import { useUIStore, useNoteStore } from '@/stores'
import { KEYBOARD_SHORTCUTS } from '@/types'

interface ShortcutHandlers {
  onInsertNumberedList?: () => void
  onInsertTodo?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export const useKeyboardShortcuts = (handlers: ShortcutHandlers = {}) => {
  const { openSearch, toggleSidebar, togglePreview, openModal } = useUIStore()
  const { selectedNoteId, deleteNote } = useNoteStore()

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs (except for specific ones)
    const target = event.target as HTMLElement
    const isInput = target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable

    // Check for modifier keys
    const hasCtrl = event.ctrlKey || event.metaKey
    const hasShift = event.shiftKey

    // Search - Ctrl+K (works even in inputs)
    if (hasCtrl && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      openSearch()
      return
    }

    // Show shortcuts - Ctrl+/
    if (hasCtrl && event.key === '/') {
      event.preventDefault()
      openModal({ type: 'shortcuts' })
      return
    }

    // App-level shortcuts — fire regardless of focus location

    // Toggle preview - Ctrl+E
    if (hasCtrl && event.key.toLowerCase() === 'e') {
      event.preventDefault()
      togglePreview()
      return
    }

    // Toggle sidebar - Ctrl+B
    if (hasCtrl && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      toggleSidebar()
      return
    }

    // Delete note - Ctrl+Delete
    if (hasCtrl && event.key === 'Delete' && selectedNoteId) {
      event.preventDefault()
      openModal({
        type: 'delete',
        data: { type: 'note', id: selectedNoteId }
      })
      return
    }

    // Skip editor-only shortcuts when not in an editable field
    if (isInput) {
      // Formatting shortcuts (only inside editor)
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

    // Escape - Close modals/search
    if (event.key === 'Escape') {
      useUIStore.getState().closeSearch()
      useUIStore.getState().closeModal()
      useUIStore.getState().closeContextMenu()
    }
  }, [
    openSearch,
    toggleSidebar,
    togglePreview,
    openModal,
    selectedNoteId,
    deleteNote,
    handlers
  ])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { shortcuts: KEYBOARD_SHORTCUTS }
}
