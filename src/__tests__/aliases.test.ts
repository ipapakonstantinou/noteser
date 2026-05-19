/**
 * aliases.test.ts
 *
 * Covers:
 *   - parseNote() — aliases extraction from YAML frontmatter
 *   - getAliasesForNote() — per-note memoisation + content-change invalidation
 *   - findNoteByTitleOrAlias() — case-insensitive lookup, title-first precedence
 */

import { parseNote } from '../utils/githubSync'
import {
  getAliasesForNote,
  findNoteByTitleOrAlias,
  _clearAliasCache,
} from '../utils/aliases'
import type { Note } from '../types'

// ── tiny note factory (only the fields wikilink resolution actually reads) ──
function makeNote(partial: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: partial.id,
    title: partial.title,
    content: partial.content ?? '',
    folderId: partial.folderId ?? null,
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
    isDeleted: partial.isDeleted ?? false,
    deletedAt: partial.deletedAt ?? null,
    isPinned: partial.isPinned ?? false,
    templateId: partial.templateId ?? null,
  }
}

beforeEach(() => {
  // Each test gets a clean memoisation cache so order doesn't matter.
  _clearAliasCache()
})

// ── parseNote.aliases ─────────────────────────────────────────────────────────

describe('parseNote — aliases', () => {
  test('no frontmatter → aliases is []', () => {
    expect(parseNote('Just a body, no fence').aliases).toEqual([])
  })

  test('frontmatter without aliases line → []', () => {
    const raw = `---\ntags: [foo, bar]\n---\nBody here`
    expect(parseNote(raw).aliases).toEqual([])
  })

  test('inline aliases array — bare identifiers', () => {
    const raw = `---\naliases: [Short, Shorter]\n---\nBody`
    expect(parseNote(raw).aliases).toEqual(['Short', 'Shorter'])
  })

  test('inline aliases array — quoted entries with spaces', () => {
    const raw = `---\naliases: [Short, "Even Shorter"]\n---\nBody`
    expect(parseNote(raw).aliases).toEqual(['Short', 'Even Shorter'])
  })

  test('quoted aliases with commas inside the quotes stay as one entry', () => {
    const raw = `---\naliases: ["Hello, World", Bye]\n---\nBody`
    expect(parseNote(raw).aliases).toEqual(['Hello, World', 'Bye'])
  })

  test('empty aliases list → []', () => {
    const raw = `---\naliases: []\n---\nBody`
    expect(parseNote(raw).aliases).toEqual([])
  })

  test('both tags and aliases coexist independently', () => {
    const raw = `---\ntags: [work, urgent]\naliases: [Foo, Bar]\n---\nBody`
    const parsed = parseNote(raw)
    expect(parsed.tags).toEqual(['work', 'urgent'])
    expect(parsed.aliases).toEqual(['Foo', 'Bar'])
  })

  test('body is preserved after frontmatter close', () => {
    const raw = `---\naliases: [X]\n---\n# Heading\n\nBody.`
    expect(parseNote(raw).body).toBe('# Heading\n\nBody.')
  })
})

// ── getAliasesForNote (memoisation) ───────────────────────────────────────────

describe('getAliasesForNote — memoisation', () => {
  test('returns aliases parsed from the note body', () => {
    const note = makeNote({
      id: 'n1',
      title: 'My Note',
      content: `---\naliases: [Alpha, "Beta One"]\n---\nBody`,
    })
    expect(getAliasesForNote(note)).toEqual(['Alpha', 'Beta One'])
  })

  test('repeated calls with unchanged content return the SAME array reference', () => {
    const note = makeNote({
      id: 'n1',
      title: 'My Note',
      content: `---\naliases: [Alpha]\n---\nBody`,
    })
    const a = getAliasesForNote(note)
    const b = getAliasesForNote(note)
    expect(b).toBe(a) // identity = cache hit
  })

  test('content change invalidates cache and reparses', () => {
    const note = makeNote({
      id: 'n1',
      title: 'My Note',
      content: `---\naliases: [Alpha]\n---\nBody`,
    })
    expect(getAliasesForNote(note)).toEqual(['Alpha'])
    const edited: Note = { ...note, content: `---\naliases: [Beta]\n---\nBody v2` }
    expect(getAliasesForNote(edited)).toEqual(['Beta'])
  })

  test('note with no frontmatter returns []', () => {
    const note = makeNote({ id: 'n1', title: 'Plain', content: 'just text' })
    expect(getAliasesForNote(note)).toEqual([])
  })
})

// ── findNoteByTitleOrAlias ────────────────────────────────────────────────────

describe('findNoteByTitleOrAlias', () => {
  const notes: Note[] = [
    makeNote({ id: 'a', title: 'Project Apollo', content: 'no aliases here' }),
    makeNote({
      id: 'b',
      title: 'Quarterly Plan',
      content: `---\naliases: [QP, "Q Plan"]\n---\nbody`,
    }),
    makeNote({ id: 'c', title: 'Recipe Book', content: '' }),
  ]

  test('exact title match (case-insensitive)', () => {
    expect(findNoteByTitleOrAlias(notes, 'project apollo')?.id).toBe('a')
    expect(findNoteByTitleOrAlias(notes, 'PROJECT APOLLO')?.id).toBe('a')
  })

  test('matches a single-word alias', () => {
    expect(findNoteByTitleOrAlias(notes, 'QP')?.id).toBe('b')
    expect(findNoteByTitleOrAlias(notes, 'qp')?.id).toBe('b')
  })

  test('matches a multi-word quoted alias', () => {
    expect(findNoteByTitleOrAlias(notes, 'Q Plan')?.id).toBe('b')
  })

  test('returns undefined when neither title nor any alias matches', () => {
    expect(findNoteByTitleOrAlias(notes, 'does-not-exist')).toBeUndefined()
  })

  test('returns undefined for empty/whitespace query', () => {
    expect(findNoteByTitleOrAlias(notes, '')).toBeUndefined()
    expect(findNoteByTitleOrAlias(notes, '   ')).toBeUndefined()
  })

  test('title-match wins over alias-match on a different note', () => {
    // Note "b" declares alias "Recipe Book" — but a different note has that
    // as its actual title. Title resolution must win.
    const collision: Note[] = [
      makeNote({
        id: 'b',
        title: 'Quarterly Plan',
        content: `---\naliases: ["Recipe Book"]\n---\nbody`,
      }),
      makeNote({ id: 'c', title: 'Recipe Book', content: '' }),
    ]
    expect(findNoteByTitleOrAlias(collision, 'Recipe Book')?.id).toBe('c')
  })
})
