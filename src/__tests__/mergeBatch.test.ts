/**
 * Workspace-store integration test for the bulk-drift conflict UX.
 *
 * Covers:
 *   - openMergeBatch creates a single 'merge-batch' tab, regardless of
 *     conflict count.
 *   - Closing the batch tab after recording resolutions fires the
 *     SYNC_REQUEST_EVENT (same trigger the per-conflict flow uses).
 *   - closeAllMergeTabs sweeps both kinds.
 */

import { useWorkspaceStore } from '../stores/workspaceStore'
import { SYNC_REQUEST_EVENT } from '../utils/events'
import type { ConflictTabData } from '../stores/workspaceStore'

function makeConflict(noteId: string, path: string): ConflictTabData {
  return {
    kind: 'conflict',
    noteId,
    path,
    localContent: `local-${noteId}`,
    remoteSha: `sha-${noteId}`,
    remoteContent: `remote-${noteId}`,
    remoteTags: [],
    remoteBody: `remote-${noteId}`,
  }
}

function resetStore(): void {
  useWorkspaceStore.setState(s => ({
    ...s,
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  }))
}

describe('openMergeBatch', () => {
  beforeEach(resetStore)

  test('opens a single merge-batch tab carrying all conflicts', () => {
    const conflicts = [
      makeConflict('a', 'Notes/A.md'),
      makeConflict('b', 'Notes/B.md'),
      makeConflict('c', 'Notes/C.md'),
      makeConflict('d', 'Notes/D.md'),
    ]
    useWorkspaceStore.getState().openMergeBatch(conflicts)

    const pane = useWorkspaceStore.getState().panes[0]
    expect(pane.tabs).toHaveLength(1)
    expect(pane.tabs[0].kind).toBe('merge-batch')
    if (pane.tabs[0].kind === 'merge-batch') {
      expect(pane.tabs[0].conflicts).toHaveLength(4)
    }
    expect(pane.activeTabId).toBe(pane.tabs[0].id)
  })

  test('replaces any existing merge tabs when opened', () => {
    useWorkspaceStore.getState().openMergeConflicts([makeConflict('x', 'X.md')])
    expect(useWorkspaceStore.getState().panes[0].tabs).toHaveLength(1)
    useWorkspaceStore.getState().openMergeBatch([
      makeConflict('a', 'A.md'),
      makeConflict('b', 'B.md'),
    ])
    const pane = useWorkspaceStore.getState().panes[0]
    expect(pane.tabs).toHaveLength(1)
    expect(pane.tabs[0].kind).toBe('merge-batch')
  })

  test('closing the batch tab AFTER recordMergeApplied fires SYNC_REQUEST_EVENT', () => {
    const conflicts = [makeConflict('a', 'A.md'), makeConflict('b', 'B.md')]
    useWorkspaceStore.getState().openMergeBatch(conflicts)
    const tabId = useWorkspaceStore.getState().panes[0].tabs[0].id

    // User resolved at least one conflict in the batch view.
    useWorkspaceStore.getState().recordMergeApplied()

    let fired = false
    const onFire = () => { fired = true }
    window.addEventListener(SYNC_REQUEST_EVENT, onFire)
    try {
      useWorkspaceStore.getState().closeTab(tabId)
    } finally {
      window.removeEventListener(SYNC_REQUEST_EVENT, onFire)
    }
    expect(fired).toBe(true)
  })

  test('closing the batch tab without recordMergeApplied does NOT fire sync', () => {
    const conflicts = [makeConflict('a', 'A.md')]
    useWorkspaceStore.getState().openMergeBatch(conflicts)
    const tabId = useWorkspaceStore.getState().panes[0].tabs[0].id
    let fired = false
    const onFire = () => { fired = true }
    window.addEventListener(SYNC_REQUEST_EVENT, onFire)
    try {
      useWorkspaceStore.getState().closeTab(tabId)
    } finally {
      window.removeEventListener(SYNC_REQUEST_EVENT, onFire)
    }
    expect(fired).toBe(false)
  })

  test('closeAllMergeTabs sweeps both merge-conflict and merge-batch tabs', () => {
    const ws = useWorkspaceStore.getState()
    ws.openMergeConflicts([makeConflict('a', 'A.md')])
    // openMergeBatch replaces existing merge tabs, so chain another open.
    ws.openMergeBatch([makeConflict('b', 'B.md'), makeConflict('c', 'C.md')])

    useWorkspaceStore.getState().closeAllMergeTabs()
    const pane = useWorkspaceStore.getState().panes[0]
    expect(pane.tabs.filter(t => t.kind === 'merge-conflict' || t.kind === 'merge-batch')).toHaveLength(0)
  })
})
