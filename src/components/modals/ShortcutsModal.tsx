'use client'

import { useUIStore } from '@/stores'
import { Modal } from '@/components/ui'
import { KEYBOARD_SHORTCUTS } from '@/types'

export const ShortcutsModal = () => {
  const { modal, closeModal } = useUIStore()

  const isOpen = modal.type === 'shortcuts'

  // Group shortcuts by category
  const navigationShortcuts = KEYBOARD_SHORTCUTS.filter(s =>
    ['openSearch', 'toggleSidebar', 'togglePreview', 'showShortcuts'].includes(s.action)
  )
  const editingShortcuts = KEYBOARD_SHORTCUTS.filter(s =>
    ['newNote', 'newFolder', 'saveNote', 'deleteNote', 'undo', 'redo'].includes(s.action)
  )
  const formattingShortcuts = KEYBOARD_SHORTCUTS.filter(s =>
    ['insertNumberedList', 'insertTodo'].includes(s.action)
  )

  const formatKey = (shortcut: typeof KEYBOARD_SHORTCUTS[0]) => {
    const parts: string[] = []
    if (shortcut.ctrl) parts.push('Ctrl')
    if (shortcut.shift) parts.push('Shift')
    if (shortcut.alt) parts.push('Alt')
    if (shortcut.meta) parts.push('⌘')
    parts.push(shortcut.key.toUpperCase())
    return parts.join(' + ')
  }

  const ShortcutRow = ({ shortcut }: { shortcut: typeof KEYBOARD_SHORTCUTS[0] }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-obsidianText">{shortcut.description}</span>
      <kbd className="px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded text-xs font-mono text-obsidianSecondaryText">
        {formatKey(shortcut)}
      </kbd>
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Keyboard Shortcuts" size="md">
      <div className="space-y-6">
        {/* Navigation */}
        <div>
          <h4 className="text-sm font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
            Navigation
          </h4>
          <div className="divide-y divide-obsidianBorder">
            {navigationShortcuts.map(shortcut => (
              <ShortcutRow key={shortcut.action} shortcut={shortcut} />
            ))}
          </div>
        </div>

        {/* Editing */}
        <div>
          <h4 className="text-sm font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
            Editing
          </h4>
          <div className="divide-y divide-obsidianBorder">
            {editingShortcuts.map(shortcut => (
              <ShortcutRow key={shortcut.action} shortcut={shortcut} />
            ))}
          </div>
        </div>

        {/* Formatting */}
        <div>
          <h4 className="text-sm font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
            Formatting
          </h4>
          <div className="divide-y divide-obsidianBorder">
            {formattingShortcuts.map(shortcut => (
              <ShortcutRow key={shortcut.action} shortcut={shortcut} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ShortcutsModal
