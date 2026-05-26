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

test('goBack focuses an already-open pinned tab without changing it', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false })
  ws().openNote('B', { preview: false })
  ws().goBack('p1')
  const pane = ws().panes.find(p => p.id === 'p1')!
  const tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.noteId === 'A').toBe(true)
  expect(tab.kind === 'note' && tab.isPreview).toBe(false)
})

// Regression — the "arrows spawn a new tab on every press / going left and
// right" bounce. In the common single-click workflow the pane holds ONE
// preview tab and the visited notes have no tabs of their own. Back/Forward
// must reuse that single preview tab, not pile up a fresh pinned tab per
// press.
test('Back/Forward through preview history reuses the single preview tab (no tab pile-up)', () => {
  const ws = () => useWorkspaceStore.getState()
  // Single-click style: each open replaces the one preview tab.
  ws().openNote('A', { preview: true })
  ws().openNote('B', { preview: true })
  ws().openNote('C', { preview: true })

  const noteTabCount = () =>
    ws().panes.flatMap(p => p.tabs).filter(t => t.kind === 'note').length

  expect(noteTabCount()).toBe(1)
  expect(activeNoteId()).toBe('C')

  ws().goBack('p1')
  expect(activeNoteId()).toBe('B')
  expect(noteTabCount()).toBe(1) // reused, not spawned

  ws().goBack('p1')
  expect(activeNoteId()).toBe('A')
  expect(noteTabCount()).toBe(1)

  ws().goForward('p1')
  expect(activeNoteId()).toBe('B')
  expect(noteTabCount()).toBe(1)

  ws().goForward('p1')
  expect(activeNoteId()).toBe('C')
  expect(noteTabCount()).toBe(1)

  // The reused tab stays a preview tab — navigation is a transient view
  // change, it must not silently pin the note.
  const pane = ws().panes.find(p => p.id === 'p1')!
  const tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.isPreview).toBe(true)
})

// Mixed: a pinned tab plus a preview slot. Navigating to the pinned note
// focuses its own tab; navigating to a note with no tab reuses the preview.
test('Back/Forward mixes pinned tabs and the preview slot correctly', () => {
  const ws = () => useWorkspaceStore.getState()
  ws().openNote('A', { preview: false }) // pinned tab for A
  ws().openNote('B', { preview: true })  // preview slot, now showing B
  ws().openNote('C', { preview: true })  // preview slot reused → C

  const noteTabCount = () =>
    ws().panes.flatMap(p => p.tabs).filter(t => t.kind === 'note').length
  // A (pinned) + the single preview tab = 2 tabs.
  expect(noteTabCount()).toBe(2)
  expect(activeNoteId()).toBe('C')

  ws().goBack('p1') // B — reuses preview slot
  expect(activeNoteId()).toBe('B')
  expect(noteTabCount()).toBe(2)

  ws().goBack('p1') // A — focuses A's own pinned tab
  expect(activeNoteId()).toBe('A')
  expect(noteTabCount()).toBe(2)
  const paneAtA = ws().panes.find(p => p.id === 'p1')!
  const tabAtA = paneAtA.tabs.find(t => t.id === paneAtA.activeTabId)!
  expect(tabAtA.kind === 'note' && tabAtA.isPreview).toBe(false) // A stays pinned

  ws().goForward('p1') // B again via preview slot
  expect(activeNoteId()).toBe('B')
  expect(noteTabCount()).toBe(2)
})

// When the pane has a history but NO note tab to focus or reuse (only a
// non-note tab, e.g. welcome, is open), navigation adds exactly ONE preview
// tab and keeps reusing it rather than spawning a pinned tab per press.
test('Back/Forward with no existing note tab opens a single reusable preview tab', () => {
  const ws = () => useWorkspaceStore.getState()
  // Pane holds a welcome tab; seed a two-entry history sitting at index 1.
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [{ id: 'w1', kind: 'welcome' }], activeTabId: 'w1' }],
    activePaneId: 'p1',
    histories: { p1: { entries: ['A', 'B'], index: 1 } },
  })

  ws().goBack('p1') // A — no note tab to focus/reuse → fresh preview tab
  expect(activeNoteId()).toBe('A')
  expect(ws().panes.flatMap(p => p.tabs).filter(t => t.kind === 'note').length).toBe(1)
  let pane = ws().panes.find(p => p.id === 'p1')!
  let tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.isPreview).toBe(true)

  ws().goForward('p1') // B — reuses the same preview tab, no pile-up
  expect(activeNoteId()).toBe('B')
  expect(ws().panes.flatMap(p => p.tabs).filter(t => t.kind === 'note').length).toBe(1)
  pane = ws().panes.find(p => p.id === 'p1')!
  tab = pane.tabs.find(t => t.id === pane.activeTabId)!
  expect(tab.kind === 'note' && tab.isPreview).toBe(true)
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
