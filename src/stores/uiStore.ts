import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContextMenuState, ModalState } from '@/types'
import { STORAGE_KEYS } from '@/utils/storageKeys'

// Section IDs for the stacked-sidebar layout (s4r3).
//   - `files` is the top section and always flex-fills the remaining
//     vertical space (no resize handle, no height entry).
//   - The others are collapsible mini-panels with persisted heights.
export type SidebarSectionId =
  | 'calendar'
  | 'outline'
  | 'backlinks'
  | 'source-control'

export interface SidebarSectionState {
  collapsed: boolean
  height: number // pixels; ignored when collapsed
}

export const DEFAULT_SECTION_HEIGHT = 220

interface UIState {
  // Sidebar
  sidebarCollapsed: boolean
  sidebarWidth: number
  // Per-section collapse + height state for the stacked layout. Keys are
  // SidebarSectionId; missing keys fall back to { collapsed: true,
  // height: DEFAULT_SECTION_HEIGHT } so a freshly-installed app shows
  // everything collapsed by default (files tree gets full height).
  sidebarSections: Partial<Record<SidebarSectionId, SidebarSectionState>>

  // Search
  isSearchOpen: boolean
  searchQuery: string

  // Preview
  isPreviewMode: boolean

  // Context Menu
  contextMenu: ContextMenuState

  // Modal
  modal: ModalState

  // View
  currentView: 'notes' | 'trash' | 'tags' | 'templates' | 'recent' | 'calendar' | 'github' | 'outline' | 'backlinks'

  // Inline-rename request from the context menu. FolderTree watches this
  // and puts the matching EditableText into edit mode, then clears it.
  renameRequest: { type: 'note' | 'folder'; id: string } | null

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  toggleSidebarSection: (id: SidebarSectionId) => void
  setSidebarSectionCollapsed: (id: SidebarSectionId, collapsed: boolean) => void
  setSidebarSectionHeight: (id: SidebarSectionId, height: number) => void
  expandSidebarSection: (id: SidebarSectionId) => void
  openSearch: () => void
  closeSearch: () => void
  setSearchQuery: (query: string) => void
  togglePreview: () => void
  setPreviewMode: (mode: boolean) => void
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
  openModal: (modal: ModalState) => void
  closeModal: () => void
  setCurrentView: (view: UIState['currentView']) => void
  requestRename: (target: { type: 'note' | 'folder'; id: string }) => void
  clearRenameRequest: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial state
      sidebarCollapsed: false,
      sidebarWidth: 256,
      sidebarSections: {},
      isSearchOpen: false,
      searchQuery: '',
      isPreviewMode: false,
      contextMenu: null,
      modal: { type: null },
      currentView: 'notes',
      renameRequest: null,

      // Actions
      toggleSidebar: () => {
        set(state => ({ sidebarCollapsed: !state.sidebarCollapsed }))
      },

      setSidebarWidth: (width) => {
        set({ sidebarWidth: Math.max(200, Math.min(500, width)) })
      },

      toggleSidebarSection: (id) => {
        set(state => {
          const cur = state.sidebarSections[id] ?? { collapsed: true, height: DEFAULT_SECTION_HEIGHT }
          return {
            sidebarSections: {
              ...state.sidebarSections,
              [id]: { ...cur, collapsed: !cur.collapsed },
            },
          }
        })
      },

      setSidebarSectionCollapsed: (id, collapsed) => {
        set(state => {
          const cur = state.sidebarSections[id] ?? { collapsed: true, height: DEFAULT_SECTION_HEIGHT }
          if (cur.collapsed === collapsed) return state
          return {
            sidebarSections: {
              ...state.sidebarSections,
              [id]: { ...cur, collapsed },
            },
          }
        })
      },

      // Clamps so a runaway drag can't push the section bigger than what
      // the viewport reasonably allows. Caller can pass any number — we
      // bound it here. Min 80px = header + a sliver of content (the
      // user can still see they have something here).
      setSidebarSectionHeight: (id, height) => {
        set(state => {
          const cur = state.sidebarSections[id] ?? { collapsed: true, height: DEFAULT_SECTION_HEIGHT }
          const clamped = Math.max(80, Math.min(2000, Math.round(height)))
          if (cur.height === clamped) return state
          return {
            sidebarSections: {
              ...state.sidebarSections,
              [id]: { ...cur, height: clamped },
            },
          }
        })
      },

      // Convenience: ribbon icons call this to open the matching panel
      // even if it was collapsed. Doesn't touch other sections.
      expandSidebarSection: (id) => {
        set(state => {
          const cur = state.sidebarSections[id] ?? { collapsed: true, height: DEFAULT_SECTION_HEIGHT }
          if (!cur.collapsed) return state
          return {
            sidebarSections: {
              ...state.sidebarSections,
              [id]: { ...cur, collapsed: false },
            },
          }
        })
      },

      openSearch: () => {
        set({ isSearchOpen: true, searchQuery: '' })
      },

      closeSearch: () => {
        set({ isSearchOpen: false, searchQuery: '' })
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query })
      },

      togglePreview: () => {
        set(state => ({ isPreviewMode: !state.isPreviewMode }))
      },

      setPreviewMode: (mode) => {
        set({ isPreviewMode: mode })
      },

      openContextMenu: (menu) => {
        set({ contextMenu: menu })
      },

      closeContextMenu: () => {
        set({ contextMenu: null })
      },

      openModal: (modal) => {
        set({ modal })
      },

      closeModal: () => {
        set({ modal: { type: null } })
      },

      setCurrentView: (view) => {
        set({ currentView: view })
      },

      requestRename: (target) => set({ renameRequest: target }),
      clearRenameRequest: () => set({ renameRequest: null }),
    }),
    {
      name: STORAGE_KEYS.ui,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        sidebarSections: state.sidebarSections,
        isPreviewMode: state.isPreviewMode,
      })
    }
  )
)
