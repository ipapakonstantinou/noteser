/**
 * @jest-environment jsdom
 *
 * activeCollabStore persistence. The store now persists the set of
 * per-note-active collab ids per-DEVICE (2026-06-15) so a note the user
 * turned live STAYS live across a reload. The in-memory shape is a Set; the
 * persisted shape is a plain string[] (JSON has no Set). These tests pin both
 * the Set semantics and the array<->Set serialization round-trip.
 */

import { useActiveCollabStore } from '../stores/activeCollabStore'

const STORAGE_KEY = 'noteser-active-collab'

beforeEach(() => {
  window.localStorage.clear()
  useActiveCollabStore.setState({ activeNoteIds: new Set() })
})

describe('activeCollabStore Set semantics', () => {
  test('activate / deactivate / toggle / isActive', () => {
    const s = useActiveCollabStore.getState()
    expect(s.isActive('n1')).toBe(false)
    s.activate('n1')
    expect(useActiveCollabStore.getState().isActive('n1')).toBe(true)
    // activate is idempotent.
    s.activate('n1')
    expect(useActiveCollabStore.getState().activeNoteIds.size).toBe(1)
    expect(useActiveCollabStore.getState().toggle('n1')).toBe(false)
    expect(useActiveCollabStore.getState().isActive('n1')).toBe(false)
    expect(useActiveCollabStore.getState().toggle('n2')).toBe(true)
    expect(useActiveCollabStore.getState().isActive('n2')).toBe(true)
  })
})

describe('activeCollabStore persistence', () => {
  test('serializes the active Set to a string[] in localStorage', () => {
    useActiveCollabStore.getState().activate('n1')
    useActiveCollabStore.getState().activate('n2')
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    // zustand persist wraps state under `.state`; the active ids are an ARRAY.
    expect(Array.isArray(parsed.state.activeNoteIds)).toBe(true)
    expect(new Set(parsed.state.activeNoteIds)).toEqual(new Set(['n1', 'n2']))
  })

  test('rehydrates the persisted ids back into a Set (survives a reload)', async () => {
    // Simulate a prior session having written an active id, then a fresh page
    // load: seed localStorage with the persisted array form and rehydrate.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { activeNoteIds: ['note-a', 'note-b'] }, version: 0 }),
    )
    await useActiveCollabStore.persist.rehydrate()
    const state = useActiveCollabStore.getState()
    expect(state.activeNoteIds instanceof Set).toBe(true)
    expect(state.isActive('note-a')).toBe(true)
    expect(state.isActive('note-b')).toBe(true)
    expect(state.isActive('note-c')).toBe(false)
  })

  test('rehydrates safely from a missing / malformed payload', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { activeNoteIds: 'not-an-array' }, version: 0 }),
    )
    await useActiveCollabStore.persist.rehydrate()
    const state = useActiveCollabStore.getState()
    expect(state.activeNoteIds instanceof Set).toBe(true)
    expect(state.activeNoteIds.size).toBe(0)
  })
})
