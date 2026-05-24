/**
 * @jest-environment jsdom
 *
 * Tests for noteStore.ensureCollabId — the lazy room-id minting used by
 * the Phase-B live-collaboration binding. The id must be stable across
 * calls (so a room survives renames) and only minted on demand (so the
 * default single-user path never grows a collabId).
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

import { useNoteStore } from '../stores/noteStore'

beforeEach(() => {
  idb.clear()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

describe('ensureCollabId', () => {
  test('mints a uuid the first time and returns the same id thereafter', () => {
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'x' })
    expect(note.collabId).toBeUndefined()

    const first = useNoteStore.getState().ensureCollabId(note.id)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)

    // Persisted on the note now.
    const stored = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(stored?.collabId).toBe(first)

    // Idempotent — second call returns the same id, no re-mint.
    const second = useNoteStore.getState().ensureCollabId(note.id)
    expect(second).toBe(first)
  })

  test('survives a rename (collabId stays put when title changes)', () => {
    const note = useNoteStore.getState().addNote({ title: 'Before', content: '' })
    const room = useNoteStore.getState().ensureCollabId(note.id)
    useNoteStore.getState().updateNote(note.id, { title: 'After' })
    const stored = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(stored?.title).toBe('After')
    expect(stored?.collabId).toBe(room)
  })

  test('returns null for an unknown note id', () => {
    expect(useNoteStore.getState().ensureCollabId('nope')).toBeNull()
  })

  test('notes that never collaborate carry no collabId (dormant default)', () => {
    const note = useNoteStore.getState().addNote({ title: 'Solo', content: 'hi' })
    // Never call ensureCollabId.
    const stored = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(stored?.collabId).toBeUndefined()
  })
})
