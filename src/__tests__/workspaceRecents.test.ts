/**
 * workspaceRecents.test.ts
 *
 * Store-level coverage for the MRU `recents` list wired into workspaceStore:
 * openNote pushes onto recents (most-recent-first, de-duplicated) and
 * pruneStaleTabs drops deleted notes from it. This list backs the "Recent"
 * view the search modal shows on an empty query.
 */

import { useWorkspaceStore } from '../stores/workspaceStore'
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

beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
    histories: {},
    recents: [],
  })
  useNoteStore.setState({
    notes: [makeNote('A', 'Alpha'), makeNote('B', 'Beta'), makeNote('C', 'Gamma')],
    selectedNoteId: null,
  })
})

test('opening notes records them most-recent-first', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })
  expect(ws().recents).toEqual(['C', 'B', 'A'])
})

test('re-opening a note moves it to the front without duplicating', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })
  ws().openNote('A', { preview: false })
  expect(ws().recents).toEqual(['A', 'C', 'B'])
})

test('focusing an already-open note still bumps it to the front of recents', () => {
  const ws = () => useWorkspaceStore.getState()
  // A and B open as pinned tabs; recents = [B, A].
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  expect(ws().recents).toEqual(['B', 'A'])
  // Re-open A — it is already open, so openNote takes the "focus existing
  // tab" branch. Recents must still reorder.
  ws().openNote('A', { preview: false })
  expect(ws().recents).toEqual(['A', 'B'])
})

test('pruneStaleTabs removes deleted notes from recents', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })
  expect(ws().recents).toEqual(['C', 'B', 'A'])

  useNoteStore.setState({
    notes: useNoteStore.getState().notes.map(n =>
      n.id === 'B' ? { ...n, isDeleted: true, deletedAt: Date.now() } : n,
    ),
  })
  ws().pruneStaleTabs()

  expect(ws().recents).toEqual(['C', 'A'])
})
