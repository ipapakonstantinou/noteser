/**
 * @jest-environment jsdom
 *
 * Feature A (share-session link) unit tests:
 *   - buildCollabShareLink produces the right origin + collabId + encoded title.
 *   - parseCollabParam reads `?collab` / `&title` back, tolerating absence.
 *   - The join decision (create-or-open) seeds a joiner's note EMPTY so the
 *     collab binding never seeds local content over the wire.
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

import { buildCollabShareLink, parseCollabParam } from '../utils/collabShare'
import { useNoteStore } from '../stores/noteStore'

beforeEach(() => {
  idb.clear()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

describe('buildCollabShareLink', () => {
  test('encodes origin + collabId + url-encoded title', () => {
    const link = buildCollabShareLink('https://noteser.app', 'room-abc', 'My Note: Draft')
    const url = new URL(link)
    expect(url.origin).toBe('https://noteser.app')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('collab')).toBe('room-abc')
    expect(url.searchParams.get('title')).toBe('My Note: Draft')
  })

  test('omits the title param entirely when blank', () => {
    expect(buildCollabShareLink('https://noteser.app', 'room-abc')).toBe(
      'https://noteser.app/?collab=room-abc',
    )
    expect(buildCollabShareLink('https://noteser.app', 'room-abc', '   ')).toBe(
      'https://noteser.app/?collab=room-abc',
    )
  })

  test('tolerates a trailing slash on the origin', () => {
    expect(buildCollabShareLink('https://noteser.app/', 'r1')).toBe(
      'https://noteser.app/?collab=r1',
    )
  })

  test('collab comes before title in the query string', () => {
    const link = buildCollabShareLink('https://x.dev', 'r1', 'Hello')
    expect(link).toBe('https://x.dev/?collab=r1&title=Hello')
  })
})

describe('parseCollabParam', () => {
  test('parses collab + title', () => {
    expect(parseCollabParam('?collab=room-1&title=Hello%20World')).toEqual({
      collabId: 'room-1', title: 'Hello World',
    })
  })

  test('parses collab with no title', () => {
    expect(parseCollabParam('?collab=room-1')).toEqual({ collabId: 'room-1', title: null })
  })

  test('blank title becomes null', () => {
    expect(parseCollabParam('?collab=room-1&title=')).toEqual({ collabId: 'room-1', title: null })
  })

  test('returns null when no collab param is present', () => {
    expect(parseCollabParam('')).toBeNull()
    expect(parseCollabParam('?import=xyz')).toBeNull()
  })

  test('round-trips a built link', () => {
    const link = buildCollabShareLink('https://noteser.app', 'room-xyz', 'A Title')
    const search = new URL(link).search
    expect(parseCollabParam(search)).toEqual({ collabId: 'room-xyz', title: 'A Title' })
  })
})

// The create-or-open decision the page join effect performs. Modelled directly
// against the real note store so we pin the contract the effect relies on.
describe('join-collab create-or-open decision', () => {
  function join(search: string): string | null {
    const parsed = parseCollabParam(search)
    if (!parsed) return null
    const existing = useNoteStore.getState().notes.find(
      n => n.collabId === parsed.collabId && !n.isDeleted,
    )
    if (existing) return existing.id
    return useNoteStore.getState().addNote({
      title: parsed.title || 'Shared note',
      folderId: null,
      content: '',
      collabId: parsed.collabId,
    }).id
  }

  test('creates an EMPTY note seeded with the collabId + title (joiner does NOT seed content)', () => {
    const id = join('?collab=room-join&title=Team%20Doc')
    const note = useNoteStore.getState().notes.find(n => n.id === id)
    expect(note).toBeDefined()
    expect(note!.collabId).toBe('room-join')
    expect(note!.title).toBe('Team Doc')
    // EMPTY body: the joiner receives the room's content over the CRDT wire, so
    // createCollabBinding's seed-on-empty (which only fires for non-empty local
    // content) must never run on their side.
    expect(note!.content).toBe('')
  })

  test('opens the existing note when one already carries that collabId (no duplicate)', () => {
    const created = useNoteStore.getState().addNote({
      title: 'Existing', content: 'keep me', collabId: 'room-dup',
    })
    const id = join('?collab=room-dup')
    expect(id).toBe(created.id)
    // No second note was created.
    expect(useNoteStore.getState().notes.filter(n => n.collabId === 'room-dup')).toHaveLength(1)
    // Its content is untouched.
    expect(useNoteStore.getState().notes.find(n => n.id === id)!.content).toBe('keep me')
  })

  test('falls back to a default title when the link carries none', () => {
    const id = join('?collab=room-untitled')
    expect(useNoteStore.getState().notes.find(n => n.id === id)!.title).toBe('Shared note')
  })
})
