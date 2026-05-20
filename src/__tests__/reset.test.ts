/**
 * reset.test.ts
 *
 * Tests for the recovery helpers in `src/utils/reset.ts`. We stub
 * idb-keyval the same way other Zustand-store tests do, and exercise
 * each pure helper directly.
 */

// ── idb-keyval mock (must come before any module that uses it) ──────────────
const idbStore = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((k: string) => Promise.resolve(idbStore.get(k))),
  set: jest.fn((k: string, v: unknown) => { idbStore.set(k, v); return Promise.resolve() }),
  del: jest.fn((k: string) => { idbStore.delete(k); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve(Array.from(idbStore.keys()))),
}))

import {
  wipeNoteserState,
  hasUnsyncedChanges,
  decideResetAction,
  readStoredResetVersion,
  writeStoredResetVersion,
  RESET_VERSION_KEY,
} from '../utils/reset'

beforeEach(() => {
  localStorage.clear()
  idbStore.clear()
})

// ── wipeNoteserState ─────────────────────────────────────────────────────────

describe('wipeNoteserState', () => {
  test('removes every noteser-* key from localStorage', async () => {
    localStorage.setItem('noteser-notes', 'a')
    localStorage.setItem('noteser-folders', 'b')
    localStorage.setItem('noteser-ui', 'c')
    localStorage.setItem('unrelated-key', 'keep-me')

    await wipeNoteserState()

    expect(localStorage.getItem('noteser-notes')).toBeNull()
    expect(localStorage.getItem('noteser-folders')).toBeNull()
    expect(localStorage.getItem('noteser-ui')).toBeNull()
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me')
  })

  test('removes every noteser-* key from idb-keyval', async () => {
    idbStore.set('noteser-notes', { v: 1 })
    idbStore.set('noteser-folders', { v: 1 })
    idbStore.set('noteser-attachment:foo.png', new Uint8Array([1, 2, 3]))
    idbStore.set('unrelated-store-key', 'keep-me')

    await wipeNoteserState()

    expect(idbStore.has('noteser-notes')).toBe(false)
    expect(idbStore.has('noteser-folders')).toBe(false)
    expect(idbStore.has('noteser-attachment:foo.png')).toBe(false)
    expect(idbStore.get('unrelated-store-key')).toBe('keep-me')
  })

  test('does not throw when localStorage is empty', async () => {
    await expect(wipeNoteserState()).resolves.not.toThrow()
  })
})

// ── hasUnsyncedChanges ───────────────────────────────────────────────────────

describe('hasUnsyncedChanges', () => {
  test('returns false when there are no active notes', () => {
    expect(hasUnsyncedChanges([], 1000)).toBe(false)
    expect(hasUnsyncedChanges([{ updatedAt: 500, isDeleted: true }], 1000)).toBe(false)
  })

  test('treats EVERY active note as unsynced when lastSyncedAt is null', () => {
    expect(hasUnsyncedChanges([{ updatedAt: 500 }], null)).toBe(true)
  })

  test('returns true when any active note was updated after the last sync', () => {
    const notes = [
      { updatedAt: 1500 }, // newer
      { updatedAt: 500 },  // older
    ]
    expect(hasUnsyncedChanges(notes, 1000)).toBe(true)
  })

  test('returns false when every update predates the last sync', () => {
    const notes = [{ updatedAt: 500 }, { updatedAt: 800 }]
    expect(hasUnsyncedChanges(notes, 1000)).toBe(false)
  })

  test('ignores soft-deleted notes for the "any-newer" check', () => {
    const notes = [
      { updatedAt: 1500, isDeleted: true }, // newer but deleted
      { updatedAt: 500 },                   // older
    ]
    expect(hasUnsyncedChanges(notes, 1000)).toBe(false)
  })
})

// ── reset version round-trip ─────────────────────────────────────────────────

describe('readStoredResetVersion / writeStoredResetVersion', () => {
  test('returns null when nothing is stored', () => {
    expect(readStoredResetVersion()).toBeNull()
  })

  test('round-trips a numeric version through localStorage', () => {
    writeStoredResetVersion(3)
    expect(readStoredResetVersion()).toBe(3)
    expect(localStorage.getItem(RESET_VERSION_KEY)).toBe('3')
  })

  test('returns null for a malformed stored value', () => {
    localStorage.setItem(RESET_VERSION_KEY, 'banana')
    expect(readStoredResetVersion()).toBeNull()
  })
})

// ── decideResetAction ────────────────────────────────────────────────────────

describe('decideResetAction', () => {
  test('noop when versions match', () => {
    const out = decideResetAction({
      storedVersion: 1,
      currentVersion: 1,
      notes: [{ updatedAt: 9999 }],
      lastSyncedAt: 0,
    })
    expect(out.action).toBe('noop')
  })

  test('wipe when version is stale and no unsynced changes', () => {
    const out = decideResetAction({
      storedVersion: 0,
      currentVersion: 1,
      notes: [{ updatedAt: 500 }],
      lastSyncedAt: 1000,
    })
    expect(out.action).toBe('wipe')
  })

  test('confirm when version is stale but there are unsynced changes', () => {
    const out = decideResetAction({
      storedVersion: 0,
      currentVersion: 1,
      notes: [{ updatedAt: 1500 }],
      lastSyncedAt: 1000,
    })
    expect(out.action).toBe('confirm')
  })

  test('confirm when version stale + never-synced + has active notes', () => {
    const out = decideResetAction({
      storedVersion: null,
      currentVersion: 1,
      notes: [{ updatedAt: 500 }],
      lastSyncedAt: null,
    })
    expect(out.action).toBe('confirm')
  })

  test('markOnly when fresh install (no notes, never synced)', () => {
    // The previous behaviour wiped + reloaded here; that flashed for new
    // visitors and broke E2E tests. Now we just stamp the version
    // forward — nothing to wipe anyway.
    const out = decideResetAction({
      storedVersion: null,
      currentVersion: 1,
      notes: [],
      lastSyncedAt: null,
    })
    expect(out.action).toBe('markOnly')
  })

  test('markOnly also covers a previously-installed user with no active notes', () => {
    // Soft-deleted notes still imply state worth not losing, but for the
    // "never synced + nothing left active" case we still markOnly. The
    // confirm branch only fires when hasUnsyncedChanges is true.
    const out = decideResetAction({
      storedVersion: 0,
      currentVersion: 1,
      notes: [{ updatedAt: 100, isDeleted: true }],
      lastSyncedAt: null,
    })
    expect(out.action).toBe('markOnly')
  })
})
