/**
 * compareSourceState.test.ts
 *
 * Coverage for the VS Code-style "Select for Compare" flow:
 *   - uiStore.compareSourceNoteId set/clear via setCompareSource /
 *     clearCompareSource.
 *   - workspaceStore.openCompare: opens a new compare tab, no-ops on
 *     same-id, focuses the existing tab on duplicate pair.
 *   - The ContextMenu auto-clears the source after dispatching
 *     openCompare (covered by the contextMenuCompare test file); here we
 *     verify the store contract in isolation.
 *
 * idb-keyval is stubbed so persist middleware doesn't reach IndexedDB.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

beforeEach(() => {
  useUIStore.setState({ compareSourceNoteId: null })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
})

describe('useUIStore — compareSourceNoteId', () => {
  test('defaults to null', () => {
    expect(useUIStore.getState().compareSourceNoteId).toBeNull()
  })

  test('setCompareSource records the id', () => {
    useUIStore.getState().setCompareSource('n-1')
    expect(useUIStore.getState().compareSourceNoteId).toBe('n-1')
  })

  test('setCompareSource(null) clears the id', () => {
    useUIStore.getState().setCompareSource('n-1')
    useUIStore.getState().setCompareSource(null)
    expect(useUIStore.getState().compareSourceNoteId).toBeNull()
  })

  test('clearCompareSource resets to null', () => {
    useUIStore.getState().setCompareSource('n-1')
    useUIStore.getState().clearCompareSource()
    expect(useUIStore.getState().compareSourceNoteId).toBeNull()
  })
})

describe('useWorkspaceStore — openCompare', () => {
  test('opens a compare tab in the active pane with the two ids', () => {
    useWorkspaceStore.getState().openCompare('n-left', 'n-right')
    const { panes } = useWorkspaceStore.getState()
    expect(panes).toHaveLength(1)
    expect(panes[0].tabs).toHaveLength(1)
    const tab = panes[0].tabs[0]
    expect(tab.kind).toBe('compare')
    if (tab.kind !== 'compare') throw new Error('expected compare tab')
    expect(tab.leftNoteId).toBe('n-left')
    expect(tab.rightNoteId).toBe('n-right')
    expect(panes[0].activeTabId).toBe(tab.id)
  })

  test('no-op when the two ids are the same', () => {
    useWorkspaceStore.getState().openCompare('n-1', 'n-1')
    expect(useWorkspaceStore.getState().panes[0].tabs).toHaveLength(0)
  })

  test('focuses the existing tab instead of opening a duplicate', () => {
    useWorkspaceStore.getState().openCompare('n-a', 'n-b')
    const firstId = useWorkspaceStore.getState().panes[0].tabs[0].id

    useWorkspaceStore.getState().openCompare('n-a', 'n-b')
    const { panes } = useWorkspaceStore.getState()
    expect(panes[0].tabs).toHaveLength(1)
    expect(panes[0].tabs[0].id).toBe(firstId)
    expect(panes[0].activeTabId).toBe(firstId)
  })

  test('treats reversed (left/right swap) as the same pair', () => {
    useWorkspaceStore.getState().openCompare('n-a', 'n-b')
    const firstId = useWorkspaceStore.getState().panes[0].tabs[0].id

    useWorkspaceStore.getState().openCompare('n-b', 'n-a')
    const { panes } = useWorkspaceStore.getState()
    expect(panes[0].tabs).toHaveLength(1)
    expect(panes[0].tabs[0].id).toBe(firstId)
  })

  test('compare tabs are excluded from persisted state (partialize)', () => {
    useWorkspaceStore.setState({
      panes: [{
        id: 'p1',
        tabs: [
          { id: 't1', kind: 'note', noteId: 'n-1', isPreview: false },
          { id: 't2', kind: 'compare', leftNoteId: 'n-a', rightNoteId: 'n-b' },
        ],
        activeTabId: 't2',
      }],
      activePaneId: 'p1',
      mergeAppliedCount: 0,
    })

    const persisted = useWorkspaceStore.persist.getOptions().partialize?.(
      useWorkspaceStore.getState(),
    ) as { panes: { tabs: { kind: string }[] }[] } | undefined

    expect(persisted).toBeTruthy()
    const persistedTabs = persisted!.panes[0].tabs
    expect(persistedTabs).toHaveLength(1)
    expect(persistedTabs[0].kind).toBe('note')
  })
})

describe('integration — opening a compare tab does not clear the source by itself', () => {
  // The store doesn't touch uiStore — clearing is the ContextMenu's job
  // after dispatching openCompare. This test pins that contract so a
  // future refactor moving the clear into the store is visible.
  test('openCompare leaves compareSourceNoteId untouched', () => {
    useUIStore.getState().setCompareSource('n-a')
    useWorkspaceStore.getState().openCompare('n-a', 'n-b')
    expect(useUIStore.getState().compareSourceNoteId).toBe('n-a')
  })
})
