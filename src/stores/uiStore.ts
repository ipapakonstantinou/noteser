import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContextMenuState, ModalState } from '@/types'
import { STORAGE_KEYS } from '@/utils/storageKeys'

// Sidebar layout (leaf model, 2026-06-04):
//
//   ┌──────────────────┐
//   │ [F][O] (strip)   │ ← group 1 strip
//   │ Files content    │
//   ├──────────────────┤
//   │ [C] (strip)      │ ← group 2 strip
//   │ Calendar content │
//   └──────────────────┘
//
// Each group has its own horizontal mini-strip + content body. No
// "pinned vs unpinned" distinction. State lives in
// settingsStore.sidebarGroups; this store only holds the chrome-level
// flags (collapsed, width, last-focused group id).
export type SidebarSectionId =
  | 'calendar'
  | 'outline'
  | 'backlinks'
  | 'source-control'
  | 'files'
  | 'search'
  | 'bookmarks'
  | 'related'
  | 'plugins'

// IDs of panels available in the sidebar. settingsStore.sidebarGroups
// decides which group(s) each one lives in; the activity bar shows
// every panel as an icon (filtered by hiddenSidebarTabs).
export type SidebarTabId =
  | 'files'
  | 'outline'
  | 'source-control'
  | 'search'
  | 'bookmarks'
  | 'calendar'
  | 'related'
  | 'plugins'

export interface SidebarSectionState {
  collapsed: boolean
  height: number // pixels; ignored when collapsed
}

export const DEFAULT_SECTION_HEIGHT = 220

// Left-sidebar width bounds (px). The default matches the old fixed
// Tailwind `w-64` (16rem = 256px) so existing users see no jump on
// upgrade. Min keeps the file tree usable; max stops a runaway drag
// from eating the editor on smaller desktop windows.
export const DEFAULT_SIDEBAR_WIDTH = 256
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 500

// Clamp + round a candidate sidebar width to the allowed range.
// Exported so the drag handler and tests share one source of truth.
export const clampSidebarWidth = (width: number): number =>
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)))

// Right-sidebar width bounds (px). Mirror of the left sidebar's
// constants — different default but the same min/max bounds so it
// can't eat the editor on either edge.
export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280
export const MIN_RIGHT_SIDEBAR_WIDTH = 200
export const MAX_RIGHT_SIDEBAR_WIDTH = 500

export const clampRightSidebarWidth = (width: number): number =>
  Math.max(MIN_RIGHT_SIDEBAR_WIDTH, Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.round(width)))

interface UIState {
  // Sidebar (left)
  sidebarCollapsed: boolean
  sidebarWidth: number
  // Right sidebar — collapsible per-note panel (Properties + Backlinks).
  // Defaults closed so first-run users don't see clutter; opening is
  // opt-in via the PanelRightIcon toggle on the right edge.
  rightSidebarOpen: boolean
  // Which tab is active in the right sidebar. Defaults to Properties.
  // RETAINED for back-compat with code paths (and tests) that pre-date
  // the leaf-model right sidebar (2026-06-04). The new layout reads
  // active tab per-group from `settingsStore.rightSidebarGroups`; this
  // field is no longer consulted by the runtime UI but is kept in the
  // persisted shape so older snapshots load cleanly.
  rightSidebarTab: 'properties' | 'backlinks'
  // Right sidebar parity (2026-06-04): collapsed flag + width + last-
  // focused group id mirror the left side's setup. `rightSidebarOpen`
  // is the legacy "open the strip" flag; `rightSidebarCollapsed` is
  // the leaf-model equivalent (true = activity bar only, false = bar
  // + panel column).
  rightSidebarCollapsed: boolean
  rightSidebarWidth: number
  lastFocusedRightGroupId: string | null
  // Per-section collapse + height state. In v2 only Calendar uses this;
  // old entries for outline/backlinks/source-control are kept for
  // backwards compat but ignored.
  sidebarSections: Partial<Record<SidebarSectionId, SidebarSectionState>>
  // ID of the group the user most recently interacted with. Used by
  // the activity-bar click handler to decide where to drop a newly-
  // added tab when the clicked panel doesn't live in any group yet.
  // Null on first load — the handler then targets the LAST group in
  // the stack, which is the bottom-most group the user is likely
  // looking at after a fresh boot.
  lastFocusedGroupId: string | null

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
  toggleRightSidebar: () => void
  setRightSidebarTab: (tab: 'properties' | 'backlinks') => void
  setRightSidebarOpen: (open: boolean) => void
  // Leaf-model right sidebar (2026-06-04) — separate from
  // toggleRightSidebar to avoid colliding with the legacy strip's
  // open/closed flag while persisted snapshots from the old layout are
  // still in circulation. Mobile / legacy code paths can keep calling
  // toggleRightSidebar; the new layout uses these.
  setRightSidebarWidth: (width: number) => void
  setRightSidebarCollapsed: (collapsed: boolean) => void
  setLastFocusedRightGroupId: (id: string | null) => void
  toggleSidebarSection: (id: SidebarSectionId) => void
  setSidebarSectionCollapsed: (id: SidebarSectionId, collapsed: boolean) => void
  setSidebarSectionHeight: (id: SidebarSectionId, height: number) => void
  expandSidebarSection: (id: SidebarSectionId) => void
  setLastFocusedGroupId: (id: string | null) => void
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
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      rightSidebarOpen: false,
      rightSidebarTab: 'properties',
      // Leaf-model right sidebar defaults OPEN (collapsed:false) so
      // first-run users see Properties + Backlinks alongside the
      // editor — same affordance as Obsidian's default workspace.
      // Diverges intentionally from the legacy `rightSidebarOpen`
      // default (which was false because the old strip was visually
      // noisy in its collapsed state); the new layout always shows
      // at least the activity bar even when collapsed, so opening
      // by default is cheap.
      rightSidebarCollapsed: false,
      rightSidebarWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH,
      lastFocusedRightGroupId: null,
      sidebarSections: {},
      lastFocusedGroupId: null,
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
        set({ sidebarWidth: clampSidebarWidth(width) })
      },

      toggleRightSidebar: () => {
        // Legacy flag — kept for back-compat with the old
        // RightSidebar component (still imported but not mounted by
        // page.tsx after the leaf-model refactor). The new layout
        // mirrors this onto `rightSidebarCollapsed`; we flip both so
        // either store consumer reads a consistent value.
        set(state => {
          const nextOpen = !state.rightSidebarOpen
          return {
            rightSidebarOpen: nextOpen,
            rightSidebarCollapsed: !nextOpen,
          }
        })
      },

      setRightSidebarTab: (rightSidebarTab) => {
        set({ rightSidebarTab })
      },

      setRightSidebarOpen: (open) => {
        set({ rightSidebarOpen: open })
      },

      setRightSidebarWidth: (width) => {
        set({ rightSidebarWidth: clampRightSidebarWidth(width) })
      },

      setRightSidebarCollapsed: (rightSidebarCollapsed) => {
        set({ rightSidebarCollapsed })
      },

      setLastFocusedRightGroupId: (id) => {
        set(state => state.lastFocusedRightGroupId === id ? state : { lastFocusedRightGroupId: id })
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

      setLastFocusedGroupId: (id) => {
        set(state => state.lastFocusedGroupId === id ? state : { lastFocusedGroupId: id })
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
      version: 1,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        rightSidebarOpen: state.rightSidebarOpen,
        rightSidebarTab: state.rightSidebarTab,
        rightSidebarCollapsed: state.rightSidebarCollapsed,
        rightSidebarWidth: state.rightSidebarWidth,
        lastFocusedRightGroupId: state.lastFocusedRightGroupId,
        sidebarSections: state.sidebarSections,
        lastFocusedGroupId: state.lastFocusedGroupId,
        isPreviewMode: state.isPreviewMode,
      }),
      // v0→v1 (2026-06-04): remove the legacy `sidebarTabId` field.
      // The new leaf model tracks active tab PER GROUP inside
      // settingsStore.sidebarGroups, so this slice no longer carries
      // an "active sidebar tab". Before discarding it, stash the value
      // in a temporary localStorage key so the settingsStore migration
      // (which runs independently when its own slice rehydrates) can
      // promote it into a trailing group via
      // `legacyToSidebarGroups(..., legacyActive)`.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 1) {
          const legacy = typeof state.sidebarTabId === 'string' ? state.sidebarTabId : null
          if (legacy) {
            try {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('__noteser_legacy_sidebar_tab_id', legacy)
              }
            } catch { /* ignore */ }
          }
          delete state.sidebarTabId
        }
        return state as unknown as UIState
      },
    }
  )
)
