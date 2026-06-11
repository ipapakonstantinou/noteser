import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { PullClassification } from '@/utils/githubSync'
import { SYNC_REQUEST_EVENT } from '@/utils/events'
import { useNoteStore } from './noteStore'
import { STORAGE_KEYS } from '@/utils/storageKeys'
import { localStorageJSON } from '@/utils/persistStorage'
import {
  type NavHistory,
  createHistory,
  push as pushHistory,
  back as backHistory,
  forward as forwardHistory,
  currentEntry as historyCurrent,
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  pruneHistory,
} from '@/utils/navHistory'
import { pushRecent, pruneRecents } from '@/utils/recents'

export type ConflictTabData = Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>

export type Tab =
  | { id: string; kind: 'note'; noteId: string; isPreview: boolean }
  | { id: string; kind: 'merge-conflict'; conflict: ConflictTabData }
  // Single tab summarising a whole batch of conflicts after a pull
  // brings back drift across many files. Lets the user resolve
  // "use mine" / "use theirs" per file (or all at once) without
  // wading through N individual merge-editor tabs. Drill-down still
  // available — the summary spawns a per-conflict merge-conflict tab
  // when the user clicks "Open merge editor" on a row.
  | { id: string; kind: 'merge-batch'; conflicts: ConflictTabData[] }
  // VS Code-style Welcome tab. Opened automatically on first run
  // instead of the old OnboardingModal popup. Not persisted (see
  // `partialize` below) — closing or reloading drops it. Closing
  // it also flips `settingsStore.onboardingShown` so it doesn't
  // reappear on the next session.
  | { id: string; kind: 'welcome' }
  // Read-only side-by-side diff between two notes (VS Code "Compare
  // with Selected"). Snapshots the two note ids at open time; the
  // view re-reads current content from the noteStore so live edits
  // reflect into the diff. Not persisted — closed on reload, same
  // as the welcome tab.
  | { id: string; kind: 'compare'; leftNoteId: string; rightNoteId: string }

export interface PaneState {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

// Layout tree describing how panes are arranged on screen. Leaves point
// back to a PaneState by id; splits arrange their two children either
// side-by-side (horizontal) or stacked top-over-bottom (vertical).
// Splits nest arbitrarily, so any Obsidian / VS Code-style arrangement
// (rows of columns, L-shapes, grids) is expressible. We carry a
// per-split ratio so the divider drag can persist.
export type LayoutNode =
  | { kind: 'leaf'; paneId: string }
  | { kind: 'split'; direction: 'horizontal' | 'vertical'; ratio: number; children: [LayoutNode, LayoutNode] }

// Obsidian and VS Code don't cap split count; this is a safety valve so
// a runaway persisted layout can't render dozens of unusable slivers.
// Anything a human would actually arrange on one screen fits well below
// it. At the cap, splits degrade to "move into an existing pane".
export const MAX_PANES = 8

// Where a dragged tab lands on a pane: the center moves it INTO the
// pane; an edge splits the pane and puts the tab on that side.
export type PaneDropRegion = 'center' | 'left' | 'right' | 'top' | 'bottom'

interface WorkspaceState {
  panes: PaneState[]              // length 1..MAX_PANES
  layout: LayoutNode              // mirrors panes[] arrangement
  activePaneId: string | null
  // Bumped each time the user clicks Apply on a merge tab; reset to 0 when a
  // new openMergeConflicts batch starts.
  mergeAppliedCount: number
  // Per-pane Obsidian-style note navigation history (Back / Forward).
  // Keyed by pane id. Not persisted — history is a point-in-time session
  // concept (matches Obsidian, which forgets pane history on reload).
  histories: Record<string, NavHistory>
  // Flat most-recently-opened note ids, most-recent-first, de-duplicated and
  // capped. Drives the "Recent" list the search modal shows on an empty
  // query (Obsidian quick-switcher / VS Code Ctrl+P style). Distinct from
  // `noteStore.getRecentNotes`, which orders by last *modified*. Persisted
  // so recents survive a reload.
  recents: string[]

  openNote: (noteId: string, opts?: { preview?: boolean; paneId?: string }) => void
  // Open (or focus, if already open) the Welcome tab. Lives in the
  // active pane. Idempotent — calling twice is a no-op past the first.
  openWelcome: () => void
  // Open a read-only side-by-side compare of two notes in a new tab.
  // No-op if the two ids are the same. If a compare tab for this pair
  // is already open in any pane it is focused instead of duplicated.
  openCompare: (leftNoteId: string, rightNoteId: string) => void
  openMergeConflicts: (conflicts: ConflictTabData[]) => void
  // Opens a SINGLE summary tab covering all conflicts. Replaces any
  // existing merge-conflict / merge-batch tabs in the workspace.
  // The threshold for using this vs per-tab merge-conflict lives in
  // useGitHubSync — the store API doesn't impose one.
  openMergeBatch: (conflicts: ConflictTabData[]) => void
  closeTab: (tabId: string) => void
  focusTab: (tabId: string) => void
  focusPane: (paneId: string) => void
  promoteTab: (tabId: string) => void
  recordMergeApplied: () => void
  closeAllMergeTabs: () => void
  pruneStaleTabs: () => void
  // Reset to a single empty pane (start fresh). Used on startup when the
  // "reopen tabs on startup" setting is off.
  resetToEmptyWorkspace: () => void
  // Reorder / move a tab. Drops the tab into the destination pane at the
  // given index. `toIdx` may be tabs.length to append.
  moveTab: (tabId: string, toPaneId: string, toIdx: number) => void
  // Take the tab out of its current pane and put it in a brand-new pane that
  // sits to the right (or alone if there's nowhere to go).
  splitTabRight: (tabId: string) => void
  // Same shape as splitTabRight but stacks the new pane BELOW the source —
  // Obsidian's "Split down". No-op once the workspace already holds
  // MAX_PANES panes.
  splitTabDown: (tabId: string) => void
  // Drop a dragged tab onto TARGET pane: 'center' moves it into that
  // pane; an edge region splits THAT pane (not the tab's source pane)
  // with the tab landing on the dropped side. At MAX_PANES an edge drop
  // degrades to a center move.
  dropTabOnPane: (tabId: string, targetPaneId: string, region: PaneDropRegion) => void
  // Persist a divider drag for a particular split node (looked up by the
  // ids of the two panes immediately on either side of it; order doesn't
  // matter). Ratio is the size fraction of the FIRST child in tree order
  // (left for horizontal, top for vertical) and is clamped to a small
  // floor so a pane can't be dragged to zero.
  setLayoutRatio: (paneA: string, paneB: string, ratio: number) => void

  // ── Navigation history (Back / Forward) ────────────────────────────────
  // Move the given pane (default: active pane) back / forward through its
  // note history, opening the target note in that pane WITHOUT recording a
  // new history entry. No-op at the ends.
  goBack: (paneId?: string) => void
  goForward: (paneId?: string) => void
  // Pure selectors for button enabled-state.
  canGoBack: (paneId?: string) => boolean
  canGoForward: (paneId?: string) => boolean
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

const DEFAULT_SPLIT_RATIO = 0.5

function leaf(paneId: string): LayoutNode {
  return { kind: 'leaf', paneId }
}

// Collect all pane ids the layout currently references, in tree order.
function leafIds(node: LayoutNode): string[] {
  if (node.kind === 'leaf') return [node.paneId]
  return [...leafIds(node.children[0]), ...leafIds(node.children[1])]
}

// Find the leaf for a given pane id and return the path from the root
// (list of child indices, 0 or 1, taken at each split).
function pathTo(node: LayoutNode, paneId: string, acc: number[] = []): number[] | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? acc : null
  const l = pathTo(node.children[0], paneId, [...acc, 0])
  if (l) return l
  return pathTo(node.children[1], paneId, [...acc, 1])
}

// Replace the subtree at `path` with a new node. Pure — returns a new
// tree, leaves the original untouched.
function replaceAt(node: LayoutNode, path: number[], next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (node.kind === 'leaf') return node // path was bogus — shouldn't happen
  const [head, ...rest] = path
  const newChild = replaceAt(node.children[head], rest, next)
  const children: [LayoutNode, LayoutNode] = head === 0
    ? [newChild, node.children[1]]
    : [node.children[0], newChild]
  return { ...node, children }
}

// Split the leaf for `paneId` into a new split node containing the
// original leaf in `originalSide` (0 = first child) and a fresh leaf for
// `newPaneId` on the opposite side. Returns the new tree; caller must
// also add the new pane to panes[].
function splitLeaf(
  layout: LayoutNode,
  paneId: string,
  newPaneId: string,
  direction: 'horizontal' | 'vertical',
  originalSide: 0 | 1 = 0,
): LayoutNode {
  const path = pathTo(layout, paneId)
  if (!path) return layout
  const original = leaf(paneId)
  const fresh = leaf(newPaneId)
  const children: [LayoutNode, LayoutNode] = originalSide === 0
    ? [original, fresh]
    : [fresh, original]
  return replaceAt(layout, path, {
    kind: 'split',
    direction,
    ratio: DEFAULT_SPLIT_RATIO,
    children,
  })
}

// Drop the leaf for `paneId` from the layout. The parent split collapses
// into its surviving child (so the tree never holds a one-child split).
// Returns null if the layout would end up empty — caller is expected to
// substitute a fresh single-leaf root.
function removeLeaf(layout: LayoutNode, paneId: string): LayoutNode | null {
  if (layout.kind === 'leaf') {
    return layout.paneId === paneId ? null : layout
  }
  const path = pathTo(layout, paneId)
  if (!path) return layout
  // Walk to the parent of the doomed leaf and replace the parent split
  // with whichever child survives.
  const parentPath = path.slice(0, -1)
  const lastIdx = path[path.length - 1] as 0 | 1
  // Resolve the parent split node.
  let parent: LayoutNode = layout
  for (const step of parentPath) {
    if (parent.kind !== 'split') return layout
    parent = parent.children[step]
  }
  if (parent.kind !== 'split') return layout
  const survivor = parent.children[lastIdx === 0 ? 1 : 0]
  return replaceAt(layout, parentPath, survivor)
}

// Find the split node that has BOTH the given pane ids as descendants on
// opposite sides — i.e. the divider that sits visually between them.
// Used to look up the ratio for a drag handle.
function findSplitBetween(node: LayoutNode, a: string, b: string): { path: number[] } | null {
  if (node.kind === 'leaf') return null
  const inLeft = leafIds(node.children[0])
  const inRight = leafIds(node.children[1])
  const aLeft = inLeft.includes(a)
  const aRight = inRight.includes(a)
  const bLeft = inLeft.includes(b)
  const bRight = inRight.includes(b)
  if ((aLeft && bRight) || (aRight && bLeft)) return { path: [] }
  const downLeft = findSplitBetween(node.children[0], a, b)
  if (downLeft) return { path: [0, ...downLeft.path] }
  const downRight = findSplitBetween(node.children[1], a, b)
  if (downRight) return { path: [1, ...downRight.path] }
  return null
}

// Core split: take `tabId` out of its source pane and place it in a NEW
// pane created by splitting `targetPaneId`'s leaf. `place` picks which
// side of the target the new pane lands on ('before' = left/top). If the
// source pane just emptied it is compacted away and the layout collapses
// — no empty husk panes (#184; the pre-2026-06 behaviour of leaving the
// source pane empty was reported as broken by the owner and removed).
function splitPaneWithTab(
  set: (partial: Partial<WorkspaceState>) => void,
  get: () => WorkspaceState,
  tabId: string,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  place: 'before' | 'after',
): void {
  const state = get()
  const loc = findTab(state.panes, tabId)
  if (!loc) return
  const sourcePane = state.panes[loc.paneIdx]
  // Splitting a pane with its own ONLY tab is a no-op: the emptied
  // source would collapse straight away and the net layout is what you
  // started with (minus the pane's history). Bail before mutating.
  if (sourcePane.id === targetPaneId && sourcePane.tabs.length === 1) return
  if (!state.panes.some(p => p.id === targetPaneId)) return

  const tab = sourcePane.tabs[loc.tabIdx]
  const draft = state.panes.map(p => ({ ...p, tabs: [...p.tabs] }))
  draft[loc.paneIdx].tabs.splice(loc.tabIdx, 1)
  if (draft[loc.paneIdx].activeTabId === tabId) {
    const remaining = draft[loc.paneIdx].tabs
    draft[loc.paneIdx].activeTabId = remaining[loc.tabIdx]?.id ?? remaining[loc.tabIdx - 1]?.id ?? null
  }

  const newPane: PaneState = { id: uuidv4(), tabs: [tab], activeTabId: tab.id }
  // splitLeaf takes the ORIGINAL pane's side: new pane 'after' ⇒ original first.
  const split = splitLeaf(state.layout, targetPaneId, newPane.id, direction, place === 'after' ? 0 : 1)
  const compacted = compactPanes([...draft, newPane])
  const layout = reconcileLayout(split, compacted)
  set({ panes: compacted, layout, activePaneId: newPane.id })
  selectNoteFromActive(compacted, newPane.id)
}

// Shared core for Split right / Split down. Direction picks how the new
// pane sits relative to the original (horizontal = right, vertical =
// below). The at-cap rejection lives here so both entry points stay in
// sync. Once the workspace already holds MAX_PANES panes we fall back
// to moving the tab into the most-recently-created pane.
function splitTabInternal(
  set: (partial: Partial<WorkspaceState>) => void,
  get: () => WorkspaceState,
  tabId: string,
  direction: 'horizontal' | 'vertical',
): void {
  const state = get()
  const loc = findTab(state.panes, tabId)
  if (!loc) return

  if (state.panes.length >= MAX_PANES) {
    // No room for a new pane — drop the tab into the last pane the user
    // created (panes are appended on split, so panes[last] is "the
    // newest one"). Preserves the "splitting at the cap = move into an
    // existing split" affordance. We move INLINE rather than via
    // moveTab so a now-empty source pane isn't compacted away — the
    // at-cap layout keeps its pane count (Obsidian leaves an empty leaf
    // sitting where the user is, mirroring splitTabRight's own "leave
    // the original pane in place but empty" rule below).
    const targetPane = state.panes[state.panes.length - 1]
    if (targetPane.id === state.panes[loc.paneIdx].id) return
    const sourcePane = state.panes[loc.paneIdx]
    const tab = sourcePane.tabs[loc.tabIdx]
    const next = state.panes.map(p => {
      if (p.id === sourcePane.id) {
        const tabs = p.tabs.filter(t => t.id !== tabId)
        const stillActive = p.activeTabId === tabId
          ? (tabs[loc.tabIdx]?.id ?? tabs[loc.tabIdx - 1]?.id ?? null)
          : p.activeTabId
        return { ...p, tabs, activeTabId: stillActive }
      }
      if (p.id === targetPane.id) {
        return { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id }
      }
      return p
    })
    set({ panes: next, activePaneId: targetPane.id })
    selectNoteFromActive(next, targetPane.id)
    return
  }

  splitPaneWithTab(set, get, tabId, state.panes[loc.paneIdx].id, direction, 'after')
}

// Re-derive a layout for a flat list of panes when the persisted layout
// is missing / stale (e.g. v2 → v3 migration, or partialize dropped it).
// Pre-v3 always meant a horizontal split between 1 or 2 panes.
function flatLayout(panes: PaneState[]): LayoutNode {
  if (panes.length === 0) return leaf(uuidv4()) // unreachable in practice
  if (panes.length === 1) return leaf(panes[0].id)
  // Recursively build a right-leaning horizontal cascade.
  const [first, ...rest] = panes
  return {
    kind: 'split',
    direction: 'horizontal',
    ratio: DEFAULT_SPLIT_RATIO,
    children: [leaf(first.id), flatLayout(rest)],
  }
}

// Drop layout entries that point at panes that no longer exist, and
// re-add any orphaned panes as right-side leaves so they don't vanish.
// Called by `set`-wrappers after pane-list mutations.
function reconcileLayout(layout: LayoutNode | undefined, panes: PaneState[]): LayoutNode {
  const paneIds = new Set(panes.map(p => p.id))
  // Prune dead leaves.
  let pruned: LayoutNode | null = layout ?? null
  if (pruned) {
    const dead = leafIds(pruned).filter(id => !paneIds.has(id))
    for (const id of dead) {
      pruned = pruned ? removeLeaf(pruned, id) : null
    }
  }
  if (!pruned) return flatLayout(panes)
  // Append any panes missing from the layout as horizontal splits on the
  // right edge — this is the historical "new pane goes to the right"
  // behaviour and only fires on recovery paths.
  const present = new Set(leafIds(pruned))
  let out = pruned
  for (const p of panes) {
    if (present.has(p.id)) continue
    out = { kind: 'split', direction: 'horizontal', ratio: DEFAULT_SPLIT_RATIO, children: [out, leaf(p.id)] }
  }
  return out
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

// Push a note view onto a pane's navigation history (creating the history
// if this pane hasn't been seen before). Returns a NEW histories map so
// callers can fold it straight into a set(). Pushing the note already at
// the cursor is a no-op inside navHistory, so re-focusing the same note
// never spams the stack.
function recordNav(
  histories: Record<string, NavHistory>,
  paneId: string,
  noteId: string,
): Record<string, NavHistory> {
  const cur = histories[paneId] ?? createHistory()
  const next = pushHistory(cur, noteId)
  if (next === cur) return histories
  return { ...histories, [paneId]: next }
}

// Open `noteId` in `paneId` as the result of a Back / Forward navigation.
// Unlike openNote this never pushes onto history — instead it writes the
// already-moved cursor (`movedHistory`) straight into the histories map.
// History is per-pane, so we keep navigation self-contained.
//
// Resolution order WITHIN the target pane (a copy open in the OTHER pane is
// left untouched — each pane navigates its own history independently):
//
//   1. The note already has a tab in this pane → focus it. We do NOT
//      promote it out of preview: Back/Forward is a transient view change,
//      not an intent to keep the note around, so a preview tab stays a
//      preview (Obsidian keeps the same tab and never silently pins on
//      navigation).
//   2. Otherwise, if the pane has a preview tab, REUSE it — rewrite its
//      noteId in place. This is the fix for the "arrows spawn a new tab on
//      every press" bounce: in the common single-click workflow the pane
//      holds one preview tab and the visited notes have no tabs of their
//      own, so the old "add a fresh pinned tab" branch piled up a new tab
//      for every Back/Forward and the active highlight jumped around the
//      strip ("going left and right"). Navigating into the existing
//      preview tab matches how single-click preview already behaves.
//   3. No tab and no preview tab to reuse → add a fresh tab. It inherits
//      the pane's "has a preview slot" expectation: we open it as a
//      preview so repeated navigation keeps reusing the one slot instead
//      of accumulating tabs.
function navigateInPane(
  set: (partial: Partial<WorkspaceState>) => void,
  get: () => WorkspaceState,
  paneId: string,
  noteId: string,
  movedHistory: NavHistory,
): void {
  const state = get()

  const pane = state.panes.find(p => p.id === paneId)

  // 1. Already open in this pane → just focus it (leave preview state as-is).
  const existing = pane?.tabs.find(t => t.kind === 'note' && t.noteId === noteId)
  if (pane && existing) {
    const next = state.panes.map(p => p.id === paneId
      ? { ...p, activeTabId: existing.id }
      : p,
    )
    set({
      panes: next,
      activePaneId: paneId,
      histories: { ...state.histories, [paneId]: movedHistory },
    })
    selectNoteFromActive(next, paneId)
    return
  }

  // 2. Reuse the pane's existing preview tab (rewrite its noteId in place)
  //    so navigation never piles up tabs.
  const previewTab = pane?.tabs.find(t => t.kind === 'note' && t.isPreview)
  if (pane && previewTab) {
    const next = state.panes.map(p => p.id === paneId
      ? {
          ...p,
          activeTabId: previewTab.id,
          tabs: p.tabs.map(t =>
            t.id === previewTab.id && t.kind === 'note'
              ? { ...t, noteId, isPreview: true }
              : t,
          ),
        }
      : p,
    )
    set({
      panes: next,
      activePaneId: paneId,
      histories: { ...state.histories, [paneId]: movedHistory },
    })
    selectNoteFromActive(next, paneId)
    return
  }

  // 3. No tab for this note and no preview slot to reuse — add one as a
  //    preview so future navigation keeps reusing this single slot.
  const id = uuidv4()
  const newTab: Tab = { id, kind: 'note', noteId, isPreview: true }
  const next = state.panes.map(p =>
    p.id === paneId ? { ...p, tabs: [...p.tabs, newTab], activeTabId: id } : p,
  )
  set({
    panes: next,
    activePaneId: paneId,
    histories: { ...state.histories, [paneId]: movedHistory },
  })
  selectNoteFromActive(next, paneId)
}

// Migrate persisted workspace state to the current shape. Exported for
// tests so the v1→v3 / v2→v3 / no-op paths can be exercised directly
// without round-tripping through the persist middleware.
//
// v1 → v2 collapsed legacy `{ tabs, activeTabId }` into a single-pane
// workspace; v2 → v3 keeps the flat panes[] but now also derives a
// LayoutNode tree so the renderer can describe horizontal AND vertical
// splits. The migration ALWAYS produces a fresh layout from the flat
// panes list — pre-v3 only ever supported a horizontal cascade.
export function migrateWorkspace(persisted: unknown, version: number): {
  panes: PaneState[]
  layout: LayoutNode
  activePaneId: string | null
  recents?: string[]
} {
  let panes: PaneState[] = []
  let activePaneId: string | null = null
  let recents: string[] | undefined

  if (version < 2 && persisted && typeof persisted === 'object') {
    const p = persisted as { tabs?: Tab[]; activeTabId?: string | null }
    const tabs = (p.tabs ?? []).filter(t => t.kind === 'note')
    panes = [{ id: uuidv4(), tabs, activeTabId: p.activeTabId ?? null }]
    activePaneId = null
  } else if (persisted && typeof persisted === 'object') {
    const p = persisted as {
      panes?: PaneState[]
      activePaneId?: string | null
      recents?: string[]
      layout?: LayoutNode
    }
    panes = Array.isArray(p.panes) && p.panes.length > 0
      ? p.panes
      : [makePane()]
    activePaneId = p.activePaneId ?? null
    recents = p.recents
    // If the persisted blob already has a layout (e.g. mid-migration
    // double-call), trust it — reconcileLayout will scrub any stale leaves.
    if (p.layout) {
      return {
        panes,
        layout: reconcileLayout(p.layout, panes),
        activePaneId,
        recents,
      }
    }
  } else {
    panes = [makePane()]
  }

  return {
    panes,
    layout: flatLayout(panes),
    activePaneId,
    recents,
  }
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const initialPane = makePane()
      return {
      panes: [initialPane],
      layout: leaf(initialPane.id),
      activePaneId: null,
      mergeAppliedCount: 0,
      histories: {},
      recents: [],

      openNote: (noteId, opts) => {
        // foreign-vault-files: refuse to open a foreign-kind note. These are
        // read-only mirrors of remote vault files (e.g. `.canvas`, `.base`)
        // that noteser does not yet know how to render. Show a toast and
        // bail without touching the workspace state so the user sees the
        // file in the tree but the editor stays on whatever was previously
        // open. Same dynamic-import pattern the rest of openNote uses to
        // avoid a static cycle with toastStore (which is fine to load lazily
        // since toasts are point-in-time feedback, not on the render path).
        const target = useNoteStore.getState().notes.find(n => n.id === noteId)
        if (target && target.kind === 'foreign') {
          if (typeof window !== 'undefined') {
            void import('./toastStore').then(({ useToastStore }) => {
              useToastStore.getState().addToast({
                kind: 'info',
                message: `noteser cannot open ${target.title} yet. The file is in your vault and visible in the tree.`,
                source: 'foreign-file-open',
              })
            }).catch(() => { /* swallow — toast is best-effort */ })
          }
          return
        }
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
          set({
            panes: next,
            activePaneId: found.pane.id,
            histories: recordNav(state.histories, found.pane.id, noteId),
            recents: pushRecent(state.recents, noteId),
          })
          selectNoteFromActive(next, found.pane.id)
          return
        }

        // Fresh tab — decide the view mode (rendered preview vs editable
        // source) it should land in.
        //
        // Behaviour: a note opens in the SAME view mode the last note was
        // in (the global isPreviewMode flag, which the editor header
        // toggle drives and which persists across reloads). We only fall
        // back to the user's "open notes in preview mode" DEFAULT when
        // there is no other note open to inherit a mode from — i.e. a cold
        // start with an empty workspace. That keeps "last-used mode wins"
        // for the common case while still honouring the default on first
        // open.
        //
        // Dynamic import to avoid a static cycle between workspace and
        // settings/ui stores. Best-effort: if the import fails (test envs
        // without the store), we just leave the global preview flag alone.
        const hasOpenNoteTab = state.panes.some(p =>
          p.tabs.some(t => t.kind === 'note'),
        )
        if (typeof window !== 'undefined' && !hasOpenNoteTab) {
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
        set({
          panes: next,
          activePaneId: targetPaneId,
          histories: recordNav(state.histories, targetPaneId, noteId),
          recents: pushRecent(state.recents, noteId),
        })
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

      openCompare: (leftNoteId, rightNoteId) => {
        if (leftNoteId === rightNoteId) return
        const state = get()
        // Focus an existing compare tab for the same pair (either order)
        // instead of opening a duplicate.
        const existing = state.panes
          .flatMap(p => p.tabs.map(t => ({ pane: p, tab: t })))
          .find(({ tab }) =>
            tab.kind === 'compare' &&
            ((tab.leftNoteId === leftNoteId && tab.rightNoteId === rightNoteId) ||
             (tab.leftNoteId === rightNoteId && tab.rightNoteId === leftNoteId)),
          )
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
        const newTab: Tab = { id, kind: 'compare', leftNoteId, rightNoteId }
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
          tabs: p.tabs.filter(t => t.kind !== 'merge-conflict' && t.kind !== 'merge-batch'),
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

      openMergeBatch: (conflicts) => {
        if (conflicts.length === 0) return
        const state = get()
        const stripped = state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind !== 'merge-conflict' && t.kind !== 'merge-batch'),
        }))
        const targetPaneId = state.activePaneId ?? stripped[0]?.id ?? null
        if (!targetPaneId) return
        const tab: Tab = { id: uuidv4(), kind: 'merge-batch', conflicts }
        const next = stripped.map(p => p.id === targetPaneId
          ? { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id }
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
        const layout = reconcileLayout(state.layout, compacted)

        // Did we just close the last merge tab (per-conflict OR batch
        // summary) in the whole workspace?
        const isMergeKind = (k: Tab['kind']) => k === 'merge-conflict' || k === 'merge-batch'
        const anyMergeLeft = compacted.some(p => p.tabs.some(t => isMergeKind(t.kind)))
        const lastMergeGone = isMergeKind(closing.kind) && !anyMergeLeft
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
          layout,
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
        // Clicking a note tab is a navigation — record it so Back returns
        // to whatever was focused before. Non-note tabs (merge / welcome)
        // don't participate in note history.
        const focusedTab = state.panes[loc.paneIdx].tabs[loc.tabIdx]
        const histories = focusedTab?.kind === 'note'
          ? recordNav(state.histories, paneId, focusedTab.noteId)
          : state.histories
        set({ panes: next, activePaneId: paneId, histories })
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
        const layout = reconcileLayout(state.layout, compacted)
        // If the moved tab's destination pane got compacted away (shouldn't
        // happen because we just inserted into it), fall back.
        const dstStillExists = compacted.some(p => p.id === toPaneId)
        const newActive = dstStillExists ? toPaneId : compacted[0].id
        set({ panes: compacted, layout, activePaneId: newActive })
        selectNoteFromActive(compacted, newActive)
      },

      splitTabRight: (tabId) => {
        splitTabInternal(set, get, tabId, 'horizontal')
      },

      splitTabDown: (tabId) => {
        splitTabInternal(set, get, tabId, 'vertical')
      },

      dropTabOnPane: (tabId, targetPaneId, region) => {
        const state = get()
        const loc = findTab(state.panes, tabId)
        if (!loc) return
        if (!state.panes.some(p => p.id === targetPaneId)) return
        const sourcePaneId = state.panes[loc.paneIdx].id
        // Center drop, or an edge drop when there's no room for another
        // pane, means "move into the pane the user pointed at".
        if (region === 'center' || state.panes.length >= MAX_PANES) {
          if (sourcePaneId === targetPaneId) return // back where it came from
          get().moveTab(tabId, targetPaneId, Number.MAX_SAFE_INTEGER)
          return
        }
        const direction = region === 'left' || region === 'right' ? 'horizontal' : 'vertical'
        const place = region === 'left' || region === 'top' ? 'before' : 'after'
        splitPaneWithTab(set, get, tabId, targetPaneId, direction, place)
      },

      setLayoutRatio: (paneA, paneB, ratio) => {
        const state = get()
        const found = findSplitBetween(state.layout, paneA, paneB)
        if (!found) return
        const clamped = Math.max(0.05, Math.min(0.95, ratio))
        // Walk to the node at `path` and rebuild with a new ratio.
        const updateRatio = (node: LayoutNode, path: number[]): LayoutNode => {
          if (node.kind === 'leaf') return node
          if (path.length === 0) return { ...node, ratio: clamped }
          const [head, ...rest] = path
          const newChild = updateRatio(node.children[head], rest)
          const children: [LayoutNode, LayoutNode] = head === 0
            ? [newChild, node.children[1]]
            : [node.children[0], newChild]
          return { ...node, children }
        }
        set({ layout: updateRatio(state.layout, found.path) })
      },

      goBack: (paneId) => {
        const state = get()
        const targetPaneId = paneId ?? state.activePaneId ?? state.panes[0]?.id
        if (!targetPaneId) return
        const hist = state.histories[targetPaneId]
        if (!hist || !historyCanGoBack(hist)) return
        const moved = backHistory(hist)
        const noteId = historyCurrent(moved)
        if (noteId == null) return
        // Open the target note in this pane WITHOUT recording history (we
        // pass the moved cursor in via the histories set below, and
        // navigateInPane opens the note without touching histories).
        navigateInPane(set, get, targetPaneId, noteId, moved)
      },

      goForward: (paneId) => {
        const state = get()
        const targetPaneId = paneId ?? state.activePaneId ?? state.panes[0]?.id
        if (!targetPaneId) return
        const hist = state.histories[targetPaneId]
        if (!hist || !historyCanGoForward(hist)) return
        const moved = forwardHistory(hist)
        const noteId = historyCurrent(moved)
        if (noteId == null) return
        navigateInPane(set, get, targetPaneId, noteId, moved)
      },

      canGoBack: (paneId) => {
        const state = get()
        const targetPaneId = paneId ?? state.activePaneId ?? state.panes[0]?.id
        if (!targetPaneId) return false
        const hist = state.histories[targetPaneId]
        return !!hist && historyCanGoBack(hist)
      },

      canGoForward: (paneId) => {
        const state = get()
        const targetPaneId = paneId ?? state.activePaneId ?? state.panes[0]?.id
        if (!targetPaneId) return false
        const hist = state.histories[targetPaneId]
        return !!hist && historyCanGoForward(hist)
      },

      closeAllMergeTabs: () => {
        const state = get()
        const stripped = state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind !== 'merge-conflict' && t.kind !== 'merge-batch'),
        }))
        const compacted = compactPanes(stripped)
        const activeStillThere = compacted.find(p => p.id === state.activePaneId)
        const newActive = activeStillThere ? state.activePaneId : compacted[0].id
        // Each pane may need a new activeTabId.
        const next = compacted.map(p => {
          const stillActive = p.tabs.find(t => t.id === p.activeTabId)
          return stillActive ? p : { ...p, activeTabId: p.tabs[p.tabs.length - 1]?.id ?? null }
        })
        const layout = reconcileLayout(state.layout, next)
        set({ panes: next, layout, activePaneId: newActive, mergeAppliedCount: 0 })
        selectNoteFromActive(next, newActive)
      },

      pruneStaleTabs: () => {
        const notes = useNoteStore.getState().notes
        // Never prune while the note store is empty. On startup that means
        // notes simply haven't loaded yet (IDB is async; a synced vault loads
        // under a repo-scoped key after mount) — NOT that every tab is
        // orphaned. Pruning here would wipe the whole restored workspace and
        // persist the empty result, so tabs would never come back on reload.
        if (notes.length === 0) return
        const liveIds = new Set(notes.filter(n => !n.isDeleted).map(n => n.id))
        const state = get()
        const next = state.panes.map(p => {
          const cleanTabs = p.tabs.filter(t => {
            if (t.kind === 'note') return liveIds.has(t.noteId)
            if (t.kind === 'compare') return liveIds.has(t.leftNoteId) && liveIds.has(t.rightNoteId)
            return true
          })
          const stillActive = cleanTabs.find(t => t.id === p.activeTabId)
          return { ...p, tabs: cleanTabs, activeTabId: stillActive?.id ?? cleanTabs[cleanTabs.length - 1]?.id ?? null }
        })
        const compacted = compactPanes(next)
        const activeStillThere = compacted.find(p => p.id === state.activePaneId)
        const newActive = activeStillThere ? state.activePaneId : compacted[0].id
        // Drop deleted notes from each pane's history + forget histories for
        // panes that no longer exist, so Back/Forward never lands on a note
        // that was deleted out from under it.
        const livePaneIds = new Set(compacted.map(p => p.id))
        const histories: Record<string, NavHistory> = {}
        for (const [pid, hist] of Object.entries(state.histories)) {
          if (!livePaneIds.has(pid)) continue
          histories[pid] = pruneHistory(hist, liveIds)
        }
        set({
          panes: compacted,
          layout: reconcileLayout(state.layout, compacted),
          activePaneId: newActive,
          histories,
          recents: pruneRecents(state.recents, liveIds),
        })
      },
      resetToEmptyWorkspace: () => {
        const pane = makePane()
        set({ panes: [pane], layout: leaf(pane.id), activePaneId: pane.id, histories: {} })
        useNoteStore.getState().selectNote(null)
      },
      }
    },
    {
      name: STORAGE_KEYS.workspace,
      // Explicit default-equivalent storage with a non-browser fallback —
      // keeps SSR / node-env Jest suites free of "storage is currently
      // unavailable" persist warnings (issue #131).
      storage: localStorageJSON,
      version: 3, // bumped: layout tree added alongside flat panes[]
      migrate: migrateWorkspace,
      partialize: (state) => ({
        // Persist only note tabs. Welcome / merge-* / compare tabs are
        // point-in-time surfaces; dropping them on reload is correct.
        panes: state.panes.map(p => ({
          ...p,
          tabs: p.tabs.filter(t => t.kind === 'note'),
        })),
        layout: state.layout,
        activePaneId: state.activePaneId,
        recents: state.recents,
      }),
    },
  ),
)
