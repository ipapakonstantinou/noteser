import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { PullClassification } from '@/utils/githubSync'
import { useNoteStore } from './noteStore'

// Just the conflict-shaped classifications (the ones the merge editor cares
// about). Re-exporting through the workspace store keeps callers from
// importing both modules.
export type ConflictTabData = Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>

export type Tab =
  | { id: string; kind: 'note'; noteId: string }
  | { id: string; kind: 'merge-conflict'; conflicts: ConflictTabData[] }

interface WorkspaceState {
  tabs: Tab[]
  activeTabId: string | null

  // Open a note as a tab. If it's already open, just focus it.
  openNote: (noteId: string) => void
  // Open one tab containing ALL current sync conflicts.
  openMergeConflicts: (conflicts: ConflictTabData[]) => void
  // Close a tab; if it was active, focus the neighbor to its left or right.
  closeTab: (tabId: string) => void
  // Make the given tab active.
  focusTab: (tabId: string) => void
  // Close every merge-conflict tab (used after sync succeeds).
  closeAllMergeTabs: () => void
  // Drop any tabs whose underlying note was deleted, on store init.
  pruneStaleTabs: () => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      openNote: (noteId) => {
        const { tabs } = get()
        const existing = tabs.find(t => t.kind === 'note' && t.noteId === noteId)
        if (existing) {
          set({ activeTabId: existing.id })
        } else {
          const id = uuidv4()
          set({ tabs: [...tabs, { id, kind: 'note', noteId }], activeTabId: id })
        }
        // Keep selectedNoteId in sync so existing UI (e.g. FolderTree highlight,
        // Editor's note lookup) still works without invasive refactors.
        useNoteStore.getState().selectNote(noteId)
      },

      openMergeConflicts: (conflicts) => {
        if (conflicts.length === 0) return
        const id = uuidv4()
        // Replace any existing merge tab with this fresh batch so we don't
        // leave stale conflicts around after another sync.
        const filtered = get().tabs.filter(t => t.kind !== 'merge-conflict')
        set({ tabs: [...filtered, { id, kind: 'merge-conflict', conflicts }], activeTabId: id })
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get()
        const idx = tabs.findIndex(t => t.id === tabId)
        if (idx === -1) return
        const next = tabs.filter(t => t.id !== tabId)
        let nextActive = activeTabId
        if (activeTabId === tabId) {
          // Prefer the tab to the right; fall back to the one to the left;
          // fall back to no active tab.
          nextActive = next[idx]?.id ?? next[idx - 1]?.id ?? null
        }
        set({ tabs: next, activeTabId: nextActive })
        // Mirror activeTab note → selectedNoteId.
        const newActive = next.find(t => t.id === nextActive)
        if (newActive?.kind === 'note') useNoteStore.getState().selectNote(newActive.noteId)
        else if (newActive == null) useNoteStore.getState().selectNote(null)
      },

      focusTab: (tabId) => {
        const tab = get().tabs.find(t => t.id === tabId)
        if (!tab) return
        set({ activeTabId: tabId })
        if (tab.kind === 'note') useNoteStore.getState().selectNote(tab.noteId)
      },

      closeAllMergeTabs: () => {
        const { tabs, activeTabId } = get()
        const next = tabs.filter(t => t.kind !== 'merge-conflict')
        const stillActive = next.find(t => t.id === activeTabId)
        const newActive = stillActive ? activeTabId : (next[next.length - 1]?.id ?? null)
        set({ tabs: next, activeTabId: newActive })
        const a = next.find(t => t.id === newActive)
        if (a?.kind === 'note') useNoteStore.getState().selectNote(a.noteId)
        else if (a == null) useNoteStore.getState().selectNote(null)
      },

      pruneStaleTabs: () => {
        const { notes } = useNoteStore.getState()
        const liveIds = new Set(notes.filter(n => !n.isDeleted).map(n => n.id))
        const next = get().tabs.filter(t => t.kind === 'note' && liveIds.has(t.noteId))
        const stillActive = next.find(t => t.id === get().activeTabId)
        set({ tabs: next, activeTabId: stillActive?.id ?? next[next.length - 1]?.id ?? null })
      },
    }),
    {
      name: 'noteser-workspace',
      // Persist only note tabs — merge-conflict tabs are point-in-time results
      // of a sync and shouldn't survive reloads.
      partialize: (state) => ({
        tabs: state.tabs.filter(t => t.kind === 'note'),
        activeTabId: state.activeTabId,
      }),
    },
  ),
)
