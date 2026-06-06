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
  const aTab = tabIdOfNote('p1', 'A')

  ws().splitTabDown(aTab)

  const state = ws()
  expect(state.panes).toHaveLength(2)
  expect(state.layout.kind).toBe('split')
  if (state.layout.kind !== 'split') throw new Error('unreachable')
  expect(state.layout.direction).toBe('vertical')
  const ids = leafIds(state.layout)
  expect(ids).toHaveLength(2)
  expect(ids).toContain('p1')

  const newPaneId = state.panes.find(p => p.id !== 'p1')!.id
  const newPane = state.panes.find(p => p.id === newPaneId)!
  expect(newPane.tabs).toHaveLength(1)
  expect(newPane.tabs[0].kind === 'note' && newPane.tabs[0].noteId === 'A').toBe(true)
  expect(state.activePaneId).toBe(newPaneId)
})

test('splitTabRight creates a horizontal split with a new pane to the right', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().splitTabRight(tabIdOfNote('p1', 'A'))

  const state = ws()
  expect(state.panes).toHaveLength(2)
  expect(state.layout.kind).toBe('split')
  if (state.layout.kind !== 'split') throw new Error('unreachable')
  expect(state.layout.direction).toBe('horizontal')
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
