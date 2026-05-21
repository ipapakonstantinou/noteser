/**
 * featureTourNote.test.ts
 *
 * Coverage for the Feature-tour seed helper. We assert:
 *   - first call creates a new note + opens it
 *   - second call finds the existing note (no duplicate created) +
 *     just opens it
 *   - the body content references the raw.githubusercontent.com CDN
 *     so images render in-app (no relative `images/` paths that would
 *     break inside a note)
 */

import { seedFeatureTourNote, FEATURE_TOUR_TITLE, FEATURE_TOUR_BODY } from '../utils/featureTourNote'
import { useNoteStore } from '../stores/noteStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
})

test('first call creates the Feature tour note and opens it', () => {
  const id = seedFeatureTourNote()

  const { notes, selectedNoteId } = useNoteStore.getState()
  expect(notes).toHaveLength(1)
  expect(notes[0].id).toBe(id)
  expect(notes[0].title).toBe(FEATURE_TOUR_TITLE)
  expect(notes[0].content).toBe(FEATURE_TOUR_BODY)
  expect(selectedNoteId).toBe(id)

  // Opened as a pinned (not preview) tab in the active pane.
  const { panes } = useWorkspaceStore.getState()
  expect(panes[0].tabs).toHaveLength(1)
  expect(panes[0].tabs[0]).toMatchObject({ kind: 'note', noteId: id, isPreview: false })
})

test('second call finds the existing note (no duplicate)', () => {
  const firstId = seedFeatureTourNote()
  const secondId = seedFeatureTourNote()

  expect(secondId).toBe(firstId)
  expect(useNoteStore.getState().notes).toHaveLength(1)
})

test('a soft-deleted Feature tour note does NOT block creating a fresh one', () => {
  const firstId = seedFeatureTourNote()
  // User trashes the tour note.
  useNoteStore.setState(state => ({
    notes: state.notes.map(n => n.id === firstId ? { ...n, isDeleted: true, deletedAt: Date.now() } : n),
  }))

  const secondId = seedFeatureTourNote()
  expect(secondId).not.toBe(firstId)
  // Two notes now: the trashed original + a fresh one.
  expect(useNoteStore.getState().notes).toHaveLength(2)
})

test('body uses the GitHub raw CDN for images (no relative paths)', () => {
  expect(FEATURE_TOUR_BODY).toContain('https://raw.githubusercontent.com/')
  // Each image reference should be fully-qualified.
  const matches = FEATURE_TOUR_BODY.match(/!\[[^\]]*\]\(([^)]+)\)/g) ?? []
  expect(matches.length).toBeGreaterThan(0)
  for (const m of matches) {
    expect(m).toMatch(/\(https?:\/\//)
  }
})
