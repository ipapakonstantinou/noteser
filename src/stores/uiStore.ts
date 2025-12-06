import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContextMenuState, ModalState } from '@/types'

interface UIState {
  // Sidebar
  sidebarCollapsed: boolean
  sidebarWidth: number

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
  currentView: 'notes' | 'trash' | 'tags' | 'templates' | 'recent'

  // Collaboration
  showCollaborators: boolean

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
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
  toggleCollaborators: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial state
      sidebarCollapsed: false,
      sidebarWidth: 256,
      isSearchOpen: false,
      searchQuery: '',
      isPreviewMode: false,
      contextMenu: null,
      modal: { type: null },
      currentView: 'notes',
      showCollaborators: true,

      // Actions
      toggleSidebar: () => {
        set(state => ({ sidebarCollapsed: !state.sidebarCollapsed }))
      },

      setSidebarWidth: (width) => {
        set({ sidebarWidth: Math.max(200, Math.min(500, width)) })
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

      toggleCollaborators: () => {
        set(state => ({ showCollaborators: !state.showCollaborators }))
      }
    }),
    {
      name: 'noteser-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        isPreviewMode: state.isPreviewMode,
        showCollaborators: state.showCollaborators
      })
    }
  )
)
