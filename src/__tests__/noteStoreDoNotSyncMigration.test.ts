/**
 * noteStoreDoNotSyncMigration.test.ts
 *
 * Verifies the noteStore persist v4 migration (#179): previously-seeded
 * "Feature tour" notes get retro-flagged `doNotSync: true` so onboarding
 * demo content stops being pushed into the user's real vault repo.
 *
 * Detection must stay conservative — exact seeded title AND a bundled
 * tour-screenshot reference in the body. A user's own note that merely
 * shares the title (or a note that references the screenshots under a
 * different title) keeps syncing untouched. The migration never deletes
 * anything, locally or remotely.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useNoteStore } from '../stores/noteStore'
import type { Note } from '@/types'

type PersistStore = typeof useNoteStore & {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } }
}
const migrate = (useNoteStore as PersistStore).persist.getOptions().migrate!

function run(notes: Partial<Note>[], version: number): Note[] {
  const out = migrate({ notes, selectedNoteId: null }, version) as { notes: Note[] }
  return out.notes
}

const TOUR_BODY = '## The editor\n\n![Welcome](Files/feature-tour/00-welcome.png)\n'

function baseNote(extra: Partial<Note>): Partial<Note> {
  return {
    id: 'n1',
    title: 'Untitled',
    content: '',
    folderId: null,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    kind: 'markdown',
    ...extra,
  }
}

test('v3 → v4 flags a seeded Feature tour note (title + screenshot marker)', () => {
  const notes = run([baseNote({ title: 'Feature tour', content: TOUR_BODY })], 3)
  expect(notes[0].doNotSync).toBe(true)
})

test('the marker works under a renamed attachments folder prefix', () => {
  const body = '![Welcome](attachments/feature-tour/00-welcome.png)\n'
  const notes = run([baseNote({ title: 'Feature tour', content: body })], 3)
  expect(notes[0].doNotSync).toBe(true)
})

test('a user note that merely shares the title is NOT flagged', () => {
  const notes = run([baseNote({ title: 'Feature tour', content: 'my own write-up of the demo' })], 3)
  expect(notes[0].doNotSync).toBeUndefined()
})

test('a note referencing the screenshots under a different title is NOT flagged', () => {
  const notes = run([baseNote({ title: 'Scratch', content: TOUR_BODY })], 3)
  expect(notes[0].doNotSync).toBeUndefined()
})

test('ordinary notes pass through unchanged', () => {
  const input = baseNote({ title: 'Groceries', content: '- [ ] milk\n' })
  const notes = run([input], 3)
  expect(notes[0]).toMatchObject({ title: 'Groceries', content: '- [ ] milk\n' })
  expect(notes[0].doNotSync).toBeUndefined()
})

test('idempotent: an already-flagged note stays flagged (and is not re-wrapped)', () => {
  const notes = run([baseNote({ title: 'Feature tour', content: TOUR_BODY, doNotSync: true })], 3)
  expect(notes[0].doNotSync).toBe(true)
})

test('v2 input gets BOTH the kind stamp and the doNotSync flag', () => {
  const v2 = baseNote({ title: 'Feature tour', content: TOUR_BODY })
  delete (v2 as { kind?: unknown }).kind
  const notes = run([v2], 2)
  expect(notes[0].kind).toBe('markdown')
  expect(notes[0].doNotSync).toBe(true)
})

test('v1 legacy input runs the full ladder (string ids, kind stamp, doNotSync flag)', () => {
  const legacy = { id: 7, title: 'Feature tour', content: TOUR_BODY }
  const notes = run([legacy as unknown as Partial<Note>], 1)
  expect(notes[0].id).toBe('7')
  expect(notes[0].kind).toBe('markdown')
  expect(notes[0].doNotSync).toBe(true)
})
