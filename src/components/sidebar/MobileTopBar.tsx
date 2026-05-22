'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  PencilIcon,
  Cog6ToothIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  TagIcon,
  StarIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore, useWorkspaceStore } from '@/stores'

// Mobile chrome bar that replaces the desktop ribbon below
// MOBILE_BREAKPOINT. Obsidian-mobile-style: tiny hamburger on the left,
// the active note's preview toggle + overflow menu on the right, NO
// always-visible ribbon column eating screen width. The overflow menu
// folds the ribbon's nav items (All notes / Recent / Tags) + Settings
// into a dropdown so the desktop affordances are still reachable.
//
// Hamburger calls `toggleSidebar`, which page.tsx reads as drawer-open
// state on mobile. Same convention as the desktop ribbon's chevron.

export const MobileTopBar = () => {
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const isPreviewMode = useUIStore(s => s.isPreviewMode)
  const togglePreview = useUIStore(s => s.togglePreview)
  const openSearch = useUIStore(s => s.openSearch)
  const openModal = useUIStore(s => s.openModal)
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const currentView = useUIStore(s => s.currentView)
  const requestRename = useUIStore(s => s.requestRename)
  const togglePinNote = useNoteStore(s => s.togglePinNote)
  // Resolve the active note (if any) so the overflow menu can offer
  // Pin / Rename for it. Mobile hides EditorHeader (Phase B aggressive
  // mode), so these gestures need a home and the overflow menu is the
  // obvious one.
  const activeNote = useActiveNote()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Tap-outside / Escape closes the overflow menu.
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const goView = (view: 'notes' | 'recent' | 'tags') => {
    setCurrentView(view)
    // Make the drawer visible too, since these views render INSIDE the
    // sidebar. Otherwise the user taps a view and nothing happens
    // because the drawer is still closed.
    const uiState = useUIStore.getState()
    if (uiState.sidebarCollapsed) toggleSidebar()
    setMenuOpen(false)
  }

  return (
    <div
      className="h-11 flex-none flex items-center gap-1 px-2 bg-obsidianBlack border-b border-obsidianBorder"
      data-testid="mobile-top-bar"
    >
      <button
        type="button"
        onClick={toggleSidebar}
        title="Open sidebar"
        aria-label="Open sidebar"
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
        data-testid="mobile-top-bar-menu"
      >
        <Bars3Icon className="w-5 h-5" />
      </button>

      {/* Active note title placeholder — Obsidian leaves the top centred
          empty on mobile too, so we keep it minimal. The flex-1 spacer
          pushes the right-side controls to the far edge. */}
      <div className="flex-1 min-w-0" />

      <button
        type="button"
        onClick={openSearch}
        title="Search (Ctrl+K)"
        aria-label="Search"
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
        data-testid="mobile-top-bar-search"
      >
        <MagnifyingGlassIcon className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={togglePreview}
        title={isPreviewMode ? 'Edit mode' : 'Preview mode'}
        aria-label={isPreviewMode ? 'Switch to edit mode' : 'Switch to preview mode'}
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
        data-testid="mobile-top-bar-preview-toggle"
      >
        {isPreviewMode ? <PencilIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          title="More"
          aria-label="More"
          aria-expanded={menuOpen}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors"
          data-testid="mobile-top-bar-overflow"
        >
          <EllipsisVerticalIcon className="w-5 h-5" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 w-52 z-50 bg-obsidianGray border border-obsidianBorder rounded shadow-obsidian py-1"
            data-testid="mobile-top-bar-overflow-menu"
          >
            {activeNote && (
              <>
                <MenuItem
                  icon={activeNote.isPinned
                    ? <StarIconSolid className="w-4 h-4 text-yellow-500" />
                    : <StarIcon className="w-4 h-4" />}
                  label={activeNote.isPinned ? 'Unpin' : 'Pin'}
                  onClick={() => { togglePinNote(activeNote.id); setMenuOpen(false) }}
                />
                <MenuItem
                  icon={<PencilIcon className="w-4 h-4" />}
                  label="Rename"
                  onClick={() => {
                    requestRename({ type: 'note', id: activeNote.id })
                    setMenuOpen(false)
                  }}
                />
                <div className="border-t border-obsidianBorder my-1" />
              </>
            )}
            <MenuItem
              icon={<DocumentDuplicateIcon className="w-4 h-4" />}
              label="All notes"
              active={currentView === 'notes'}
              onClick={() => goView('notes')}
            />
            <MenuItem
              icon={<ClockIcon className="w-4 h-4" />}
              label="Recent"
              active={currentView === 'recent'}
              onClick={() => goView('recent')}
            />
            <MenuItem
              icon={<TagIcon className="w-4 h-4" />}
              label="Tags"
              active={currentView === 'tags'}
              onClick={() => goView('tags')}
            />
            <div className="border-t border-obsidianBorder my-1" />
            <MenuItem
              icon={<Cog6ToothIcon className="w-4 h-4" />}
              label="Settings"
              onClick={() => { openModal({ type: 'settings' }); setMenuOpen(false) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const MenuItem = ({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
      active
        ? 'bg-obsidianAccentPurple/15 text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText'
    }`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
)

// Resolve the active pane's active note tab so the overflow menu can
// surface Pin / Rename for the note the user is looking at. Returns
// undefined when no note tab is focused (welcome / merge tab / empty
// pane all return undefined → menu hides the per-note items).
function useActiveNote() {
  const panes = useWorkspaceStore(s => s.panes)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const notes = useNoteStore(s => s.notes)
  const pane = panes.find(p => p.id === activePaneId) ?? panes[0]
  const tab = pane?.tabs.find(t => t.id === pane?.activeTabId)
  if (!tab || tab.kind !== 'note') return undefined
  return notes.find(n => n.id === tab.noteId)
}

export default MobileTopBar
