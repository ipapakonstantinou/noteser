import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { PullClassification } from '@/utils/githubSync'
import { SYNC_REQUEST_EVENT } from '@/utils/events'
import { useNoteStore } from './noteStore'
import { STORAGE_KEYS } from '@/utils/storageKeys'

export type ConflictTabData = Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>

export type Tab =
  | { id: string; kind: 'note'; noteId: string; isPreview: boolean }
  | { id: string; kind: 'merge-conflict'; conflict: ConflictTabData }
  // VS Code-style Welcome tab. Opened automatically on first run
  // instead of the old OnboardingModal popup. Not persisted (see
  // `partialize` below) — closing or reloading drops it. Closing
  // it also flips `settingsStore.onboardingShown` so it doesn't
  // reappear on the next session.
  | { id: string; kind: 'welcome' }

export interface PaneState {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

interface WorkspaceState {
  panes: PaneState[]              // length 1 or 2 (horizontal split)
  activePaneId: string | null
  // Bumped each time the user clicks Apply on a merge tab; reset to 0 when a
  // new openMergeConflicts batch starts.
  mergeAppliedCount: number

  openNote: (noteId: string, opts?: { preview?: boolean; paneId?: string }) => void
  // Open (or focus, if already open) the Welcome tab. Lives in the
  // active pane. Idempotent — calling twice is a no-op past the first.
  openWelcome: () => void
  openMergeConflicts: (conflicts: ConflictTabData[]) => void
  closeTab: (tabId: string) => void
  focusTab: (tabId: string) => void
  focusPane: (paneId: string) => void
  promoteTab: (tabId: string) => void
  recordMergeApplied: () => void
  closeAllMergeTabs: () => void
  pruneStaleTabs: () => void
  // Reorder / move a tab. Drops the tab into the destination pane at the
  // given index. `toIdx` may be tabs.length to append.
  moveTab: (tabId: string, toPaneId: string, toIdx: number) => void
  // Take the tab out of its current pane and put it in a brand-new pane that
  // sits to the right (or alone if there's nowhere to go).
  splitTabRight: (tabId: string) => void
}

function findTab(panes: PaneState[], tabId: string): { paneIdx: number; tabIdx: number } | null {
  for (let pi = 0; pi < panes.length; pi++) {
    const ti = panes[pi].tabs.findIndex(t => t.id === tabId)
    if (ti >= 0) return { paneIdx: pi, tabIdx: ti }
  }
  return null
}

function makePane(): PaneState {
  return { id: uuidv4(), tabs: [], activeTabId: null }
}

function selectNoteFromActive(panes: PaneState[], activePaneId: string | null): void {
  const pane = panes.find(p => p.id === activePaneId)
  const active = pane?.tabs.find(t => t.id === pane.activeTabId)
  if (active?.kind === 'note') useNoteStore.getState().selectNote(active.noteId)
  else if (!active) useNoteStore.getState().selectNote(null)
}

// Drop any panes that ended up empty. Always keep at least one pane.
function compactPanes(panes: PaneState[]): PaneState[] {
  const kept = panes.filter(p => p.tabs.length > 0)
  return kept.length === 0 ? [makePane()] : kept
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      panes: [makePane()],
      activePaneId: null,
      mergeAppliedCount: 0,

      openNote: (noteId, opts) => {
        const preview = opts?.preview ?? true
        const state = get()
        // Default target pane: caller-specified, else active pane, else first.
        const targetPaneId = opts?.paneId
          ?? state.activePaneId
          ?? state.panes[0]?.id
        if (!targetPaneId) return

        // If the note is already open in ANY pane, focus that tab.
        const found = state.panes.flatMap(p => p.tabs.map(t => ({ pane: p, tab: t })))
          .find(({ tab }) => tab.kind === 'note' && tab.noteId === noteId)
        if (found) {
          const next = state.panes.map(p => p.id === found.pane.id
            ? {
                ...p,
                activeTabId: found.tab.id,
                tabs: p.tabs.map(t =>
                  t.id === found.tab.id && t.kind === 'note' && !preview && t.isPreview
                    ? { ...t, isPreview: false }
                    : t,
                ),
              }
            : p,
          )
          set({ panes: next, activePaneId: found.pane.id })
          selectNoteFromActive(next, found.pane.id)
          return
        }

        // Fresh tab — apply the user's "open notes in preview mode"
        // default. Dynamic import to avoid a static cycle between
        // workspace and settings stores. Best-effort: if the import
        // fails (test envs without the store), we just leave the
        // global preview flag alone.
        if (typeof window !== 'undefined') {
          import('./settingsStore').then(({ useSettingsStore }) => {
            const preferPreview = useSettingsStore.getState().notesOpenInPreviewMode
            import('./uiStore').then(({ useUIStore }) => {
              if (useUIStore.getState().isPreviewMode !== preferPreview) {
                useUIStore.getState().setPreviewMode(preferPreview)
              }
            }).catch(() => { /* swallow */ })
          }).catch(() => { /* swallow */ })
        }

        // Adding a new tab. In preview mode, replace any existing preview tab
        // *within the target pane*.
        const next = state.panes.map(p => {
          if (p.id !== targetPaneId) return p
          if (preview) {
            const previewIdx = p.tabs.findIndex(t => t.kind === 'note' && t.isPreview)
            if (previewIdx >= 0) {
              const id = p.tabs[previewIdx].id
              const nextTabs = [...p.tabs]
              nextTabs[previewIdx] = { id, kind: 'note' as const, noteId, isPreview: true }
              return { ...p, tabs: nextTabs, activeTabId: id }
            }
          }
          const id = uuidv4()
          const newTab: Tab = { id, kind: 'note', noteId, isPreview: preview }
          return {
            ...p,
            tabs: [...p.tabs, newTab],
            activeTabId: id,
          }
        })
        set({ panes: next, activePaneId: targetPaneId })
        selectNoteFromActive(next, targetPaneId)
      },

      openWelcome: () => {
        const state = get()
        // If a welcome tab is already open anywhere, focus it instead
        // of creating a second one.
        const existing = state.panes.flatMap(p => p.tabs.map(t => ({ pane: p, tab: t })))
          .find(({ tab }) => tab.kind === 'welcome')
        if (existing) {
          const next = state.panes.map(p =>
            p.id === existing.pane.id ? { ...p, activeTabId: existing.tab.id } : p,
          )
          set({ panes: next, activePaneId: existing.pane.id })
          return
        }
        const targetPaneId = state.activePaneId ?? state.panes[0]?.id
        if (!targetPaneId) return
        const id = uuidv4()
        const newTab: Tab = { id, kind: 'welcome' }
        const next = state.panes.map(p =>
          p.id === targetPaneId
            ? { ...p, tabs: [...p.tabs, newTab], activeTabId: id }
            : p,
        )
        set({ panes: next, activePaneId: targetPaneId })
      },

      promoteTab: (tabId) => {
        set(state => ({
          panes: state.panes.map(p => ({
            ...p,
            tabs: p.tabs.map(t =>
              t.id === tabId && t.kind === 'note' && t.isPreview
                ? { ...t, isPreview: false }
                : t,
            ),
          })),
        }))
      },

      openMergeConflicts: (conflicts) => {
        if (conflicts.length === 0) return
        const state = get()
        // Drop any stale merge tabs across ALL panes.
        const stripped = state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind !== 'merge-conflict'),
        }))
        // Add new merge tabs to the active pane (or first pane).
        const targetPaneId = state.activePaneId ?? stripped[0]?.id ?? null
        if (!targetPaneId) return
        const newTabs: Tab[] = conflicts.map(conflict => ({
          id: uuidv4(),
          kind: 'merge-conflict' as const,
          conflict,
        }))
        const next = stripped.map(p => p.id === targetPaneId
          ? { ...p, tabs: [...p.tabs, ...newTabs], activeTabId: newTabs[0].id }
          : p,
        )
        set({ panes: next, activePaneId: targetPaneId, mergeAppliedCount: 0 })
      },

      recordMergeApplied: () => set(state => ({ mergeAppliedCount: state.mergeAppliedCount + 1 })),

      closeTab: (tabId) => {
        const state = get()
        const loc = findTab(state.panes, tabId)
        if (!loc) return
        const sourcePane = state.panes[loc.paneIdx]
        const closing = sourcePane.tabs[loc.tabIdx]

        const newTabs = sourcePane.tabs.filter(t => t.id !== tabId)
        let newActiveTabId = sourcePane.activeTabId
        if (sourcePane.activeTabId === tabId) {
          newActiveTabId = newTabs[loc.tabIdx]?.id ?? newTabs[loc.tabIdx - 1]?.id ?? null
        }

        const updatedPanes = state.panes.map((p, i) =>
          i === loc.paneIdx ? { ...p, tabs: newTabs, activeTabId: newActiveTabId } : p,
        )
        const compacted = compactPanes(updatedPanes)

        // Did we just close the last merge tab in the whole workspace?
        const anyMergeLeft = compacted.some(p => p.tabs.some(t => t.kind === 'merge-conflict'))
        const lastMergeGone = closing.kind === 'merge-conflict' && !anyMergeLeft
        const shouldFireSync = lastMergeGone && state.mergeAppliedCount > 0

        // Closing the welcome tab counts as "user has seen and dismissed
        // the first-run experience" — flip onboardingShown so it doesn't
        // reopen next session. Dynamic import to avoid a static cycle
        // between workspaceStore and settingsStore.
        if (closing.kind === 'welcome') {
          import('./settingsStore').then(({ useSettingsStore }) => {
            useSettingsStore.getState().setOnboardingShown(true)
          }).catch(() => { /* settings store unavailable — best effort */ })
        }

        // If the source pane was removed by compaction, fall back to the
        // surviving pane for focus.
        const sourceStillExists = compacted.some(p => p.id === sourcePane.id)
        const newActivePaneId = sourceStillExists ? sourcePane.id : compacted[0].id

        set({
          panes: compacted,
          activePaneId: newActivePaneId,
          mergeAppliedCount: lastMergeGone ? 0 : state.mergeAppliedCount,
        })
        selectNoteFromActive(compacted, newActivePaneId)

        if (shouldFireSync && typeof window !== 'undefined') {
          window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
        }
      },

      focusTab: (tabId) => {
        const state = get()
        const loc = findTab(state.panes, tabId)
        if (!loc) return
        const next = state.panes.map((p, i) =>
          i === loc.paneIdx ? { ...p, activeTabId: tabId } : p,
        )
        const paneId = state.panes[loc.paneIdx].id
        set({ panes: next, activePaneId: paneId })
        selectNoteFromActive(next, paneId)
      },

      focusPane: (paneId) => {
        const state = get()
        if (!state.panes.some(p => p.id === paneId)) return
        set({ activePaneId: paneId })
        selectNoteFromActive(state.panes, paneId)
      },

      moveTab: (tabId, toPaneId, toIdx) => {
        const state = get()
        const loc = findTab(state.panes, tabId)
        if (!loc) return
        const tab = state.panes[loc.paneIdx].tabs[loc.tabIdx]

        // Remove from source pane.
        const draft = state.panes.map(p => ({ ...p, tabs: [...p.tabs] }))
        draft[loc.paneIdx].tabs.splice(loc.tabIdx, 1)
        if (draft[loc.paneIdx].activeTabId === tabId) {
          const remaining = draft[loc.paneIdx].tabs
          draft[loc.paneIdx].activeTabId = remaining[loc.tabIdx]?.id ?? remaining[loc.tabIdx - 1]?.id ?? null
        }

        // Insert into destination pane.
        const dstIdx = draft.findIndex(p => p.id === toPaneId)
        if (dstIdx < 0) return
        // Account for index shift if moving within the same pane to a later position.
        const sameP = dstIdx === loc.paneIdx
        const insertAt = sameP && toIdx > loc.tabIdx ? toIdx - 1 : toIdx
        draft[dstIdx].tabs.splice(Math.max(0, Math.min(insertAt, draft[dstIdx].tabs.length)), 0, tab)
        draft[dstIdx].activeTabId = tab.id

        const compacted = compactPanes(draft)
        // If the moved tab's destination pane got compacted away (shouldn't
        // happen because we just inserted into it), fall back.
        const dstStillExists = compacted.some(p => p.id === toPaneId)
        const newActive = dstStillExists ? toPaneId : compacted[0].id
        set({ panes: compacted, activePaneId: newActive })
        selectNoteFromActive(compacted, newActive)
      },

      splitTabRight: (tabId) => {
        const state = get()
        if (state.panes.length >= 2) {
          // Already split — move the tab to the right pane instead.
          const rightPane = state.panes[1]
          get().moveTab(tabId, rightPane.id, rightPane.tabs.length)
          return
        }
        const loc = findTab(state.panes, tabId)
        if (!loc) return
        const tab = state.panes[loc.paneIdx].tabs[loc.tabIdx]

        const draft = state.panes.map(p => ({ ...p, tabs: [...p.tabs] }))
        draft[loc.paneIdx].tabs.splice(loc.tabIdx, 1)
        if (draft[loc.paneIdx].activeTabId === tabId) {
          const remaining = draft[loc.paneIdx].tabs
          draft[loc.paneIdx].activeTabId = remaining[loc.tabIdx]?.id ?? remaining[loc.tabIdx - 1]?.id ?? null
        }

        const newPane: PaneState = { id: uuidv4(), tabs: [tab], activeTabId: tab.id }
        // Obsidian behaviour: splitting the ONLY tab leaves the
        // original pane in place but empty. Previously we dropped
        // the empty left pane and ended up with just one pane (the
        // new right one), which is functionally a no-op split — the
        // tab "moved" rather than "split". Keep both panes always;
        // an empty pane renders an EmptyState in Pane.tsx.
        const panes: PaneState[] = [...draft, newPane]
        set({ panes, activePaneId: newPane.id })
        selectNoteFromActive(panes, newPane.id)
      },

      closeAllMergeTabs: () => {
        const state = get()
        const stripped = state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind !== 'merge-conflict'),
        }))
        const compacted = compactPanes(stripped)
        const activeStillThere = compacted.find(p => p.id === state.activePaneId)
        const newActive = activeStillThere ? state.activePaneId : compacted[0].id
        // Each pane may need a new activeTabId.
        const next = compacted.map(p => {
          const stillActive = p.tabs.find(t => t.id === p.activeTabId)
          return stillActive ? p : { ...p, activeTabId: p.tabs[p.tabs.length - 1]?.id ?? null }
        })
        set({ panes: next, activePaneId: newActive, mergeAppliedCount: 0 })
        selectNoteFromActive(next, newActive)
      },

      pruneStaleTabs: () => {
        const liveIds = new Set(useNoteStore.getState().notes.filter(n => !n.isDeleted).map(n => n.id))
        const state = get()
        const next = state.panes.map(p => {
          const cleanTabs = p.tabs.filter(t => t.kind !== 'note' || liveIds.has(t.noteId))
          const stillActive = cleanTabs.find(t => t.id === p.activeTabId)
          return { ...p, tabs: cleanTabs, activeTabId: stillActive?.id ?? cleanTabs[cleanTabs.length - 1]?.id ?? null }
        })
        const compacted = compactPanes(next)
        const activeStillThere = compacted.find(p => p.id === state.activePaneId)
        const newActive = activeStillThere ? state.activePaneId : compacted[0].id
        set({ panes: compacted, activePaneId: newActive })
      },
    }),
    {
      name: STORAGE_KEYS.workspace,
      version: 2, // bumped: shape changed from tabs[] to panes[]
      migrate: (persisted, version) => {
        // v1 had { tabs, activeTabId }. Merge into a single pane.
        if (version < 2 && persisted && typeof persisted === 'object') {
          const p = persisted as { tabs?: Tab[]; activeTabId?: string | null }
          const tabs = (p.tabs ?? []).filter(t => t.kind === 'note')
          return {
            panes: [{ id: uuidv4(), tabs, activeTabId: p.activeTabId ?? null }],
            activePaneId: null,
          }
        }
        return persisted as { panes: PaneState[]; activePaneId: string | null }
      },
      partialize: (state) => ({
        // Persist only note tabs.
        panes: state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind === 'note'),
        })),
        activePaneId: state.activePaneId,
      }),
    },
  ),
)
