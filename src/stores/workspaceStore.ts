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
  // isPreview tabs are italic + ephemeral (VS Code-style). One single-click on
  // a sidebar note opens it as a preview that REPLACES any existing preview
  // tab. Double-click pins it; editing also pins it.
  | { id: string; kind: 'note'; noteId: string; isPreview: boolean }
  | { id: string; kind: 'merge-conflict'; conflict: ConflictTabData }

interface WorkspaceState {
  tabs: Tab[]
  activeTabId: string | null
  // Bumped each time the user clicks Apply on a merge tab; reset to 0 when a
  // new openMergeConflicts batch starts. Used to decide whether the final
  // merge-tab close should trigger a re-sync.
  mergeAppliedCount: number

  // Open a note as a tab. Preview tabs are italic + replaceable; pinned tabs
  // are permanent until closed.
  openNote: (noteId: string, opts?: { preview?: boolean }) => void
  // Open one merge-conflict tab per file in the batch and focus the first.
  openMergeConflicts: (conflicts: ConflictTabData[]) => void
  // Close a tab; if it was active, focus the neighbor. If the last
  // merge-conflict tab is being closed AND at least one Apply happened in
  // this batch, dispatch 'noteser:sync-request' so the sidebar re-runs sync.
  closeTab: (tabId: string) => void
  focusTab: (tabId: string) => void
  // Promote the currently-previewed tab to a pinned tab. Called from the
  // editor as soon as the user types into a preview tab's note.
  promoteTab: (tabId: string) => void
  recordMergeApplied: () => void
  closeAllMergeTabs: () => void
  pruneStaleTabs: () => void
}

const SYNC_REQUEST_EVENT = 'noteser:sync-request'

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      mergeAppliedCount: 0,

      openNote: (noteId, opts) => {
        const preview = opts?.preview ?? true
        const { tabs } = get()
        const existing = tabs.find(t => t.kind === 'note' && t.noteId === noteId)
        if (existing && existing.kind === 'note') {
          // Already open. Promote it to pinned if the caller explicitly asked.
          if (!preview && existing.isPreview) {
            set({
              tabs: tabs.map(t => t.id === existing.id && t.kind === 'note' ? { ...t, isPreview: false } : t),
              activeTabId: existing.id,
            })
          } else {
            set({ activeTabId: existing.id })
          }
          useNoteStore.getState().selectNote(noteId)
          return
        }

        if (preview) {
          // Replace any existing preview tab with this new one.
          const previewIdx = tabs.findIndex(t => t.kind === 'note' && t.isPreview)
          if (previewIdx >= 0) {
            const id = tabs[previewIdx].id
            const next = [...tabs]
            next[previewIdx] = { id, kind: 'note', noteId, isPreview: true }
            set({ tabs: next, activeTabId: id })
            useNoteStore.getState().selectNote(noteId)
            return
          }
        }

        const id = uuidv4()
        set({
          tabs: [...tabs, { id, kind: 'note', noteId, isPreview: preview }],
          activeTabId: id,
        })
        useNoteStore.getState().selectNote(noteId)
      },

      promoteTab: (tabId) => {
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === tabId && t.kind === 'note' && t.isPreview
              ? { ...t, isPreview: false }
              : t,
          ),
        }))
      },

      openMergeConflicts: (conflicts) => {
        if (conflicts.length === 0) return
        // Drop any stale merge tabs from a previous sync.
        const filtered = get().tabs.filter(t => t.kind !== 'merge-conflict')
        const newTabs: Tab[] = conflicts.map(conflict => ({
          id: uuidv4(),
          kind: 'merge-conflict' as const,
          conflict,
        }))
        set({
          tabs: [...filtered, ...newTabs],
          activeTabId: newTabs[0].id,
          mergeAppliedCount: 0,
        })
      },

      recordMergeApplied: () => {
        set(state => ({ mergeAppliedCount: state.mergeAppliedCount + 1 }))
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId, mergeAppliedCount } = get()
        const idx = tabs.findIndex(t => t.id === tabId)
        if (idx === -1) return
        const closing = tabs[idx]
        const next = tabs.filter(t => t.id !== tabId)

        // Decide focus.
        let nextActive = activeTabId
        if (activeTabId === tabId) {
          nextActive = next[idx]?.id ?? next[idx - 1]?.id ?? null
        }

        // If we just closed the last merge tab AND any Apply happened, run sync.
        const lastMergeGone = closing.kind === 'merge-conflict'
          && !next.some(t => t.kind === 'merge-conflict')
        const shouldFireSync = lastMergeGone && mergeAppliedCount > 0

        set({
          tabs: next,
          activeTabId: nextActive,
          mergeAppliedCount: lastMergeGone ? 0 : mergeAppliedCount,
        })

        const newActive = next.find(t => t.id === nextActive)
        if (newActive?.kind === 'note') useNoteStore.getState().selectNote(newActive.noteId)
        else if (newActive == null) useNoteStore.getState().selectNote(null)

        if (shouldFireSync && typeof window !== 'undefined') {
          window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
        }
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
        set({ tabs: next, activeTabId: newActive, mergeAppliedCount: 0 })
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
      // Persist only note tabs — merge tabs are sync-point-in-time results.
      // Preserve isPreview so a preview tab stays italic after reload (matches
      // VS Code).
      partialize: (state) => ({
        tabs: state.tabs.filter(t => t.kind === 'note'),
        activeTabId: state.activeTabId,
      }),
    },
  ),
)
