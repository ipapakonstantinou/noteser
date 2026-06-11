/**
 * workspaceSplits.test.ts
 *
 * Coverage for the multi-pane split workspace:
 *   - splitTabRight / splitTabDown create a fresh pane on the requested side
 *     and update the LayoutNode tree.
 *   - The 3-pane cap is enforced — a fourth split is rejected (the tab
 *     moves into the newest existing pane instead).
 *   - Closing the last tab in a pane re-collapses the layout so the
 *     surviving panes' arrangement is preserved.
 *   - The persisted v2 → v3 workspace migration wraps the flat panes[]
 *     array into a horizontal-cascade layout tree and survives a reload
 *     (running the migrate function twice is idempotent).
 */

import {
  useWorkspaceStore,
  migrateWorkspace,
  type LayoutNode,
  type PaneState,
} from '../stores/workspaceStore'
import { useNoteStore } from '../stores/noteStore'

const makeNote = (id: string, title: string) => ({
  id,
  title,
  content: `# ${title}`,
  folderId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isDeleted: false,
  deletedAt: null,
  isPinned: false,
  templateId: null,
})

function leafIds(node: LayoutNode): string[] {
  if (node.kind === 'leaf') return [node.paneId]
  return [...leafIds(node.children[0]), ...leafIds(node.children[1])]
}

beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    layout: { kind: 'leaf', paneId: 'p1' },
    activePaneId: 'p1',
    mergeAppliedCount: 0,
    histories: {},
  })
  useNoteStore.setState({
    notes: [makeNote('A', 'Alpha'), makeNote('B', 'Beta'), makeNote('C', 'Gamma'), makeNote('D', 'Delta')],
    selectedNoteId: null,
  })
})

const tabIdOfNote = (paneId: string, noteId: string): string => {
  const pane = useWorkspaceStore.getState().panes.find(p => p.id === paneId)!
  const tab = pane.tabs.find(t => t.kind === 'note' && t.noteId === noteId)
  if (!tab) throw new Error(`no tab for ${noteId} in ${paneId}`)
  return tab.id
}

test('splitTabDown creates a vertical split with a new pane below', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })

  ws().splitTabDown(tabIdOfNote('p1', 'A'))

  const state = ws()
  expect(state.panes).toHaveLength(2)
  expect(state.layout.kind).toBe('split')
  if (state.layout.kind !== 'split') throw new Error('unreachable')
  expect(state.layout.direction).toBe('vertical')
  const ids = leafIds(state.layout)
  expect(ids).toHaveLength(2)
  expect(ids).toContain('p1')

  // Source pane keeps B; the new pane gets A; nothing is left empty.
  const p1 = state.panes.find(p => p.id === 'p1')!
  expect(p1.tabs.some(t => t.kind === 'note' && t.noteId === 'B')).toBe(true)
  const newPane = state.panes.find(p => p.id !== 'p1')!
  expect(newPane.tabs).toHaveLength(1)
  expect(newPane.tabs[0].kind === 'note' && newPane.tabs[0].noteId === 'A').toBe(true)
  expect(state.panes.every(p => p.tabs.length > 0)).toBe(true)
  expect(state.activePaneId).toBe(newPane.id)
})

test('splitTabRight creates a horizontal split with a new pane to the right', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().splitTabRight(tabIdOfNote('p1', 'A'))

  const state = ws()
  expect(state.panes).toHaveLength(2)
  expect(state.layout.kind).toBe('split')
  if (state.layout.kind !== 'split') throw new Error('unreachable')
  expect(state.layout.direction).toBe('horizontal')
  expect(state.panes.every(p => p.tabs.length > 0)).toBe(true)
})

test("splitting a pane's only tab is a no-op — no empty husk pane (#184)", () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  const before = ws().panes

  ws().splitTabRight(tabIdOfNote('p1', 'A'))

  expect(ws().panes).toBe(before) // untouched, not even a new array
  expect(ws().panes).toHaveLength(1)
  expect(ws().layout.kind).toBe('leaf')
})

describe('dropTabOnPane', () => {
  // Build the canonical 2-pane workspace: p1=[A], p2=[B] side by side.
  const twoPane = () => {
    const ws = () => useWorkspaceStore.getState()
    ws().openNote('A', { preview: false })
    ws().openNote('B', { preview: false })
    ws().splitTabRight(tabIdOfNote('p1', 'B'))
    const p2 = ws().panes.find(p => p.id !== 'p1')!
    return { ws, p2Id: p2.id }
  }

  test('edge drop splits the TARGET pane, not the source pane', () => {
    const { ws, p2Id } = twoPane()
    ws().openNote('C', { preview: false }) // lands in active pane (p2)... force into p1:
    // openNote opens in the ACTIVE pane; make p1 active first.
    // Simpler: move C's tab explicitly if it landed elsewhere.
    const cLoc = ws().panes.find(p => p.tabs.some(t => t.kind === 'note' && t.noteId === 'C'))!
    const cTab = cLoc.tabs.find(t => t.kind === 'note' && t.noteId === 'C')!
    if (cLoc.id !== 'p1') ws().moveTab(cTab.id, 'p1', Number.MAX_SAFE_INTEGER)

    // Drop C (from p1) on p2's BOTTOM edge → vertical split of p2's leaf.
    ws().dropTabOnPane(cTab.id, p2Id, 'bottom')

    const state = ws()
    expect(state.panes).toHaveLength(3)
    // p1 must be untouched at the layout root level; the vertical split
    // wraps p2's leaf only.
    expect(state.layout.kind).toBe('split')
    if (state.layout.kind !== 'split') throw new Error('unreachable')
    const right = state.layout.children[1]
    expect(right.kind).toBe('split')
    if (right.kind !== 'split') throw new Error('unreachable')
    expect(right.direction).toBe('vertical')
    // New pane (with C) sits BELOW p2.
    expect(right.children[0]).toEqual({ kind: 'leaf', paneId: p2Id })
    const newLeaf = right.children[1]
    expect(newLeaf.kind).toBe('leaf')
    const newPane = state.panes.find(p => p.tabs.some(t => t.kind === 'note' && t.noteId === 'C'))!
    if (newLeaf.kind === 'leaf') expect(newLeaf.paneId).toBe(newPane.id)
  })

  test("edge drop with place-before ('top'/'left') puts the new pane first", () => {
    const { ws, p2Id } = twoPane()
    // Drop A (p1's only tab) on p2's TOP edge: p1 empties and collapses,
    // p2's leaf becomes a vertical split with the new pane on top.
    ws().dropTabOnPane(tabIdOfNote('p1', 'A'), p2Id, 'top')

    const state = ws()
    expect(state.panes).toHaveLength(2) // p1 compacted away
    expect(state.panes.some(p => p.id === 'p1')).toBe(false)
    expect(state.panes.every(p => p.tabs.length > 0)).toBe(true)
    expect(state.layout.kind).toBe('split')
    if (state.layout.kind !== 'split') throw new Error('unreachable')
    expect(state.layout.direction).toBe('vertical')
    const newPane = state.panes.find(p => p.id !== p2Id)!
    expect(state.layout.children[0]).toEqual({ kind: 'leaf', paneId: newPane.id })
    expect(state.layout.children[1]).toEqual({ kind: 'leaf', paneId: p2Id })
  })

  test('center drop moves the tab INTO the target pane (appended last, active)', () => {
    const { ws, p2Id } = twoPane()
    ws().dropTabOnPane(tabIdOfNote('p1', 'A'), p2Id, 'center')

    const state = ws()
    expect(state.panes).toHaveLength(1) // p1 emptied and compacted
    const p2 = state.panes[0]
    expect(p2.id).toBe(p2Id)
    expect(p2.tabs).toHaveLength(2)
    expect(p2.tabs[1].kind === 'note' && p2.tabs[1].noteId === 'A').toBe(true)
    expect(p2.activeTabId).toBe(p2.tabs[1].id)
    expect(state.layout).toEqual({ kind: 'leaf', paneId: p2Id })
  })

  test('center drop on the tab’s own pane is a no-op', () => {
    const { ws } = twoPane()
    const before = ws().panes
    ws().dropTabOnPane(tabIdOfNote('p1', 'A'), 'p1', 'center')
    expect(ws().panes).toBe(before)
  })

  test('edge drop at MAX_PANES degrades to a move into the target pane', () => {
    const ws = () => useWorkspaceStore.getState()
    ws().openNote('A', { preview: false })
    ws().openNote('B', { preview: false })
    ws().openNote('C', { preview: false })
    ws().openNote('D', { preview: false })
    ws().splitTabRight(tabIdOfNote('p1', 'B'))
    const p2Id = ws().panes.find(p => p.id !== 'p1')!.id
    ws().dropTabOnPane(tabIdOfNote('p1', 'C'), p2Id, 'bottom')
    expect(ws().panes).toHaveLength(3)
    const p3Id = ws().panes.find(p => p.id !== 'p1' && p.id !== p2Id)!.id

    // 4th pane impossible → 'right' on p2 must MOVE D into p2 instead.
    ws().dropTabOnPane(tabIdOfNote('p1', 'D'), p2Id, 'right')
    const state = ws()
    expect(state.panes).toHaveLength(3)
    const p2 = state.panes.find(p => p.id === p2Id)!
    expect(p2.tabs.some(t => t.kind === 'note' && t.noteId === 'D')).toBe(true)
    expect(state.panes.find(p => p.id === p3Id)).toBeTruthy()
  })
})

test('a 4th split is rejected — workspace stays at 3 panes (tab moves into newest pane)', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })
  ws().openNote('D', { preview: false })

  ws().splitTabRight(tabIdOfNote('p1', 'A'))
  ws().splitTabDown(tabIdOfNote('p1', 'B'))
  expect(ws().panes).toHaveLength(3)

  ws().splitTabRight(tabIdOfNote('p1', 'C'))
  expect(ws().panes).toHaveLength(3)

  const newest = ws().panes[ws().panes.length - 1]
  const hasC = newest.tabs.some(t => t.kind === 'note' && t.noteId === 'C')
  expect(hasC).toBe(true)

  ws().splitTabDown(tabIdOfNote('p1', 'D'))
  expect(ws().panes).toHaveLength(3)
})

test('closing the last tab in a split pane re-collapses the layout', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  // p1 = [A, B]. Split A out to the right — p1 keeps B, new pane gets A.
  ws().splitTabRight(tabIdOfNote('p1', 'A'))
  expect(ws().panes).toHaveLength(2)
  expect(ws().layout.kind).toBe('split')

  const newPaneId = ws().panes.find(p => p.id !== 'p1')!.id
  const lonelyTab = ws().panes.find(p => p.id === newPaneId)!.tabs[0]
  ws().closeTab(lonelyTab.id)

  expect(ws().panes).toHaveLength(1)
  expect(ws().layout.kind).toBe('leaf')
  if (ws().layout.kind === 'leaf') {
    expect((ws().layout as { kind: 'leaf'; paneId: string }).paneId).toBe('p1')
  }
})

test('closing one of three panes collapses to a single split (not a single leaf)', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })

  ws().splitTabRight(tabIdOfNote('p1', 'A'))
  ws().splitTabDown(tabIdOfNote('p1', 'B'))
  expect(ws().panes).toHaveLength(3)

  const allPanes = ws().panes
  const pane2 = allPanes.find(p => p.tabs.some(t => t.kind === 'note' && t.noteId === 'A'))!
  ws().closeTab(pane2.tabs[0].id)

  expect(ws().panes).toHaveLength(2)
  expect(ws().layout.kind).toBe('split')
})

describe('workspace migration', () => {
  test('v1 → v3 wraps the legacy { tabs, activeTabId } into a single-pane workspace + leaf layout', () => {
    const legacy = {
      tabs: [
        { id: 't1', kind: 'note', noteId: 'A', isPreview: false },
        { id: 't2', kind: 'note', noteId: 'B', isPreview: true },
      ],
      activeTabId: 't1',
    }
    const migrated = migrateWorkspace(legacy, 1)
    expect(migrated.panes).toHaveLength(1)
    expect(migrated.panes[0].tabs).toHaveLength(2)
    expect(migrated.layout.kind).toBe('leaf')
    if (migrated.layout.kind === 'leaf') {
      expect(migrated.layout.paneId).toBe(migrated.panes[0].id)
    }
  })

  test('v2 → v3 derives a horizontal-cascade layout from the flat panes[] array', () => {
    const v2: { panes: PaneState[]; activePaneId: string | null } = {
      panes: [
        { id: 'pA', tabs: [], activeTabId: null },
        { id: 'pB', tabs: [], activeTabId: null },
      ],
      activePaneId: 'pA',
    }
    const migrated = migrateWorkspace(v2, 2)
    expect(migrated.panes.map(p => p.id)).toEqual(['pA', 'pB'])
    expect(migrated.layout.kind).toBe('split')
    if (migrated.layout.kind !== 'split') throw new Error('unreachable')
    expect(migrated.layout.direction).toBe('horizontal')
    expect(leafIds(migrated.layout).sort()).toEqual(['pA', 'pB'])
  })

  test('migration is idempotent across reloads (running migrateWorkspace on its own output preserves shape)', () => {
    const v2: { panes: PaneState[]; activePaneId: string | null } = {
      panes: [
        { id: 'pA', tabs: [], activeTabId: null },
        { id: 'pB', tabs: [], activeTabId: null },
      ],
      activePaneId: 'pA',
    }
    const once = migrateWorkspace(v2, 2)
    const twice = migrateWorkspace(once, 3)
    expect(twice.panes.map(p => p.id)).toEqual(once.panes.map(p => p.id))
    expect(twice.layout).toEqual(once.layout)
  })

  test('v3 already-migrated payload with a layout passes through (reconciled, but pane ids preserved)', () => {
    const v3 = {
      panes: [
        { id: 'pA', tabs: [], activeTabId: null },
        { id: 'pB', tabs: [], activeTabId: null },
      ],
      activePaneId: 'pA',
      layout: {
        kind: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { kind: 'leaf', paneId: 'pA' },
          { kind: 'leaf', paneId: 'pB' },
        ],
      },
    }
    const out = migrateWorkspace(v3, 3)
    expect(out.layout.kind).toBe('split')
    if (out.layout.kind !== 'split') throw new Error('unreachable')
    expect(out.layout.direction).toBe('vertical')
    expect(leafIds(out.layout).sort()).toEqual(['pA', 'pB'])
  })

  test('a layout that references a missing pane is reconciled — dead leaves are dropped', () => {
    const broken = {
      panes: [{ id: 'pA', tabs: [], activeTabId: null }],
      activePaneId: 'pA',
      layout: {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { kind: 'leaf', paneId: 'pA' },
          { kind: 'leaf', paneId: 'ghost' },
        ],
      },
    }
    const out = migrateWorkspace(broken, 3)
    const ids = leafIds(out.layout)
    expect(ids).toEqual(['pA'])
  })
})

test('setLayoutRatio updates the divider position for the split between two panes', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().splitTabRight(tabIdOfNote('p1', 'A'))

  const newPaneId = ws().panes.find(p => p.id !== 'p1')!.id
  ws().setLayoutRatio('p1', newPaneId, 0.7)

  const layout = ws().layout
  expect(layout.kind).toBe('split')
  if (layout.kind !== 'split') throw new Error('unreachable')
  expect(layout.ratio).toBeCloseTo(0.7)

  ws().setLayoutRatio('p1', newPaneId, 0.001)
  const layout2 = ws().layout
  if (layout2.kind !== 'split') throw new Error('unreachable')
  expect(layout2.ratio).toBeCloseTo(0.05)
})
