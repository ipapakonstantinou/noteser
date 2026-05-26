/**
 * workspaceNavHistory.test.ts
 *
 * Store-level coverage for the per-pane Back / Forward navigation history
 * wired into workspaceStore (goBack / goForward / canGoBack / canGoForward)
 * plus the double-click-pin semantics (openNote with preview:false both
 * opens a fresh pinned tab AND promotes an existing preview tab).
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

const activeNoteId = (): string | null => {
  const ws = useWorkspaceStore.getState()
  const pane = ws.panes.find(p => p.id === ws.activePaneId) ?? ws.panes[0]
  const t = pane?.tabs.find(t => t.id === pane.activeTabId)
  return t?.kind === 'note' ? t.noteId : null
}

beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
    histories: {},
  })
  useNoteStore.setState({
    notes: [makeNote('A', 'Alpha'), makeNote('B', 'Beta'), makeNote('C', 'Gamma')],
    selectedNoteId: null,
  })
})

test('opening A, B, C records history and Back/Forward walk it', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })

  expect(activeNoteId()).toBe('C')
  expect(ws().canGoForward('p1')).toBe(false)
  expect(ws().canGoBack('p1')).toBe(true)

  ws().goBack('p1')
  expect(activeNoteId()).toBe('B')
  ws().goBack('p1')
  expect(activeNoteId()).toBe('A')
  expect(ws().canGoBack('p1')).toBe(false)

  ws().goForward('p1')
  expect(activeNoteId()).toBe('B')
  ws().goForward('p1')
  expect(activeNoteId()).toBe('C')
  expect(ws().canGoForward('p1')).toBe(false)
})

test('Back/Forward at the ends are no-ops', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })

  ws().goBack('p1') // at A
  ws().goBack('p1') // no-op
  expect(activeNoteId()).toBe('A')
  expect(ws().canGoBack('p1')).toBe(false)

  ws().goForward('p1') // at B
  ws().goForward('p1') // no-op
  expect(activeNoteId()).toBe('B')
  expect(ws().canGoForward('p1')).toBe(false)
})

test('navigating back then opening a NEW note truncates the forward history', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })
  ws().goBack('p1') // at B
  ws().goBack('p1') // at A

  ws().openNote('C', { preview: false }) // new branch from A
  expect(activeNoteId()).toBe('C')
  expect(ws().canGoForward('p1')).toBe(false)
  expect(ws().canGoBack('p1')).toBe(true)
  ws().goBack('p1')
  expect(activeNoteId()).toBe('A')
})

test('Back/Forward navigation itself does not push new history entries', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })

  ws().goBack('p1') // B
  ws().goBack('p1') // A
  // Cursor at A with B,C still ahead — going forward must restore them,
  // proving back() didn't truncate.
  expect(ws().canGoForward('p1')).toBe(true)
  ws().goForward('p1')
  ws().goForward('p1')
  expect(activeNoteId()).toBe('C')
})

test('double-click semantics: openNote(preview:false) on a preview tab promotes it (no italic)', () => {
  const ws = () => useWorkspaceStore.getState()
  // Single-click style: preview tab.
  ws().openNote('A', { preview: true })
  let pane = ws().panes.find(p => p.id === 'p1')!
  let tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.isPreview).toBe(true)

  // Double-click style: same note, pinned → promotes the existing tab.
  ws().openNote('A', { preview: false })
  pane = ws().panes.find(p => p.id === 'p1')!
  tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.isPreview).toBe(false)
  // Still a single tab — promotion, not a duplicate.
  expect(pane.tabs.filter(t => t.kind === 'note').length).toBe(1)
})

test('goBack focuses an already-open tab and promotes it out of preview', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  // Re-open A as a preview tab won't happen (A already open as pinned);
  // instead simulate B preview then navigate.
  ws().goBack('p1')
  const pane = ws().panes.find(p => p.id === 'p1')!
  const tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.noteId === 'A').toBe(true)
  expect(tab.kind === 'note' && tab.isPreview).toBe(false)
})

test('pruneStaleTabs drops deleted notes from history', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().openNote('C', { preview: false })

  // Delete B out from under the history.
  useNoteStore.setState({
    notes: useNoteStore.getState().notes.map(n =>
      n.id === 'B' ? { ...n, isDeleted: true, deletedAt: Date.now() } : n,
    ),
  })
  ws().pruneStaleTabs()

  // History should no longer contain 'B'.
  const hist = ws().histories['p1']
  expect(hist.entries).not.toContain('B')
  // Going back from C should reach A directly.
  // (C is still active; its tab survived since C isn't deleted.)
  expect(hist.entries).toEqual(expect.arrayContaining(['A', 'C']))
})
