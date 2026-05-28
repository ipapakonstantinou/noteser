/**
 * pruneStaleTabsGuard.test.ts
 *
 * Regression for the reload-loses-tabs bug: on a synced vault the note store
 * is empty for a moment at startup (IDB is async + the real notes live under a
 * repo-scoped key switched in after mount). pruneStaleTabs must NOT treat that
 * empty window as "every tab is orphaned" and wipe the restored workspace.
 */

import { useWorkspaceStore } from '../stores/workspaceStore'
import { useNoteStore } from '../stores/noteStore'
import type { Note } from '../types'

function note(id: string): Note {
  return {
    id, title: id, content: '', folderId: null,
    createdAt: 1, updatedAt: 1, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
  } as Note
}

beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [{ id: 't1', kind: 'note', noteId: 'n1', isPreview: false }], activeTabId: 't1' }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
})

test('does NOT wipe tabs while the note store is empty (startup race)', () => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useWorkspaceStore.getState().pruneStaleTabs()
  const { panes } = useWorkspaceStore.getState()
  expect(panes[0].tabs).toHaveLength(1)
  expect(panes[0].tabs[0]).toMatchObject({ kind: 'note', noteId: 'n1' })
})

test('keeps a tab whose note exists once notes are loaded', () => {
  useNoteStore.setState({ notes: [note('n1')], selectedNoteId: 'n1' })
  useWorkspaceStore.getState().pruneStaleTabs()
  expect(useWorkspaceStore.getState().panes[0].tabs).toHaveLength(1)
})

test('still prunes a genuinely stale tab when other notes are present', () => {
  // n1 tab is open, but the loaded vault only has n2 → n1 is truly orphaned.
  useNoteStore.setState({ notes: [note('n2')], selectedNoteId: 'n2' })
  useWorkspaceStore.getState().pruneStaleTabs()
  const { panes } = useWorkspaceStore.getState()
  expect(panes[0].tabs.find(t => t.kind === 'note' && t.noteId === 'n1')).toBeUndefined()
})
