/**
 * brokenLinks.test.ts
 *
 * Covers findBrokenWikilinks() — the pure scanner behind the Broken Links
 * panel. It walks every note's `[[Target]]` / `![[Target]]` occurrences and
 * reports the ones that don't resolve to an existing note (by title or
 * alias) or a known attachment.
 */

import { findBrokenWikilinks } from '../utils/brokenLinks'
import { _clearAliasCache } from '../utils/aliases'
import type { Note } from '../types'

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
  _clearAliasCache()
})

describe('findBrokenWikilinks', () => {
  test('no links at all → []', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: 'nothing here' })]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('link resolves to an existing note → not reported', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: 'see [[B]]' }),
      makeNote({ id: 'b', title: 'B' }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('link to a missing note → reported with target + line', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: 'see [[Missing]] here' })]
    const result = findBrokenWikilinks(notes)
    expect(result).toHaveLength(1)
    expect(result[0].noteId).toBe('a')
    expect(result[0].title).toBe('A')
    expect(result[0].links).toEqual([
      { target: 'Missing', fragment: null, isEmbed: false, line: 1 },
    ])
  })

  test('case-insensitive title match — mirrors findNoteByTitleOrAlias', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: 'see [[project apollo]] and [[PROJECT APOLLO]]' }),
      makeNote({ id: 'b', title: 'Project Apollo' }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('alias match — target declares an alias, link uses it', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: 'see [[Short]]' }),
      makeNote({
        id: 'b',
        title: 'Full Title',
        content: `---\naliases: [Short]\n---\nBody`,
      }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('link to a known attachment resolves via the resolveAttachment callback', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: 'see ![[photo.png]]' })]
    const resolveAttachment = (target: string) =>
      target === 'photo.png' ? 'attachments/photo.png' : null
    expect(findBrokenWikilinks(notes, { resolveAttachment })).toEqual([])
  })

  test('link to an unknown attachment is reported as broken', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: 'see ![[missing.png]]' })]
    const resolveAttachment = () => null
    const result = findBrokenWikilinks(notes, { resolveAttachment })
    expect(result).toHaveLength(1)
    expect(result[0].links[0]).toEqual({
      target: 'missing.png', fragment: null, isEmbed: true, line: 1,
    })
  })

  test('without a resolveAttachment callback, an attachment-only target is reported broken', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: '![[photo.png]]' })]
    const result = findBrokenWikilinks(notes)
    expect(result).toHaveLength(1)
    expect(result[0].links[0].target).toBe('photo.png')
  })

  test('embed vs plain link — isEmbed reflects the leading "!"', () => {
    const notes = [makeNote({
      id: 'a', title: 'A',
      content: '[[Missing]]\n![[Missing]]',
    })]
    const result = findBrokenWikilinks(notes)
    expect(result[0].links.map(l => l.isEmbed)).toEqual([false, true])
  })

  test('aliased link [[target|alias]] resolves/reports on the target, not the alias', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: 'see [[Missing|click here]]' })]
    const result = findBrokenWikilinks(notes)
    expect(result[0].links[0].target).toBe('Missing')
  })

  test('aliased link to an existing note is not reported', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: 'see [[B|click here]]' }),
      makeNote({ id: 'b', title: 'B' }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('heading fragment [[target#heading]] — broken iff the note itself is missing', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: '[[B#Some heading]] and [[Missing#Heading]]' }),
      makeNote({ id: 'b', title: 'B' }),
    ]
    const result = findBrokenWikilinks(notes)
    expect(result).toHaveLength(1)
    expect(result[0].links).toEqual([
      { target: 'Missing', fragment: 'Heading', isEmbed: false, line: 1 },
    ])
  })

  test('block-ref fragment [[target#^blockid]] keeps the fragment on the reported entry', () => {
    const notes = [makeNote({ id: 'a', title: 'A', content: '[[Missing#^abc-123]]' })]
    const result = findBrokenWikilinks(notes)
    expect(result[0].links[0].fragment).toBe('^abc-123')
  })

  test('self-referential link that resolves is not reported (unlike findBacklinks, self isn\'t excluded)', () => {
    const notes = [makeNote({ id: 'a', title: 'Self', content: 'I am [[Self]]' })]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('self-referential link that does NOT resolve is still reported', () => {
    const notes = [makeNote({ id: 'a', title: 'Self', content: 'I am [[Slef]]' })]
    const result = findBrokenWikilinks(notes)
    expect(result).toHaveLength(1)
    expect(result[0].noteId).toBe('a')
    expect(result[0].links[0].target).toBe('Slef')
  })

  test('links inside a fenced code block are not flagged as broken', () => {
    const notes = [makeNote({
      id: 'a', title: 'A',
      content: '```\nexample: [[Missing]]\n```',
    })]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('a broken link outside a fence is still reported when another fence exists in the same note', () => {
    const notes = [makeNote({
      id: 'a', title: 'A',
      content: [
        '[[Missing]]',
        '```',
        '[[AlsoMissing]]',
        '```',
        '[[StillMissing]]',
      ].join('\n'),
    })]
    const result = findBrokenWikilinks(notes)
    expect(result[0].links.map(l => l.target)).toEqual(['Missing', 'StillMissing'])
    expect(result[0].links.map(l => l.line)).toEqual([1, 5])
  })

  test('tilde fences (~~~) are also excluded', () => {
    const notes = [makeNote({
      id: 'a', title: 'A',
      content: '~~~\n[[Missing]]\n~~~',
    })]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('deleted notes are not scanned', () => {
    const notes = [makeNote({
      id: 'a', title: 'A', content: '[[Missing]]', isDeleted: true, deletedAt: 1,
    })]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('a deleted note still resolves a link to it (matches findNoteByTitleOrAlias, which does not filter deleted notes)', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: '[[B]]' }),
      makeNote({ id: 'b', title: 'B', isDeleted: true, deletedAt: 1 }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })

  test('multiple notes each contribute their own broken links', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: '[[Missing1]]' }),
      makeNote({ id: 'b', title: 'B', content: '[[Missing2]] and [[Missing3]]' }),
      makeNote({ id: 'c', title: 'C', content: 'no links here' }),
    ]
    const result = findBrokenWikilinks(notes)
    expect(result.map(r => r.noteId).sort()).toEqual(['a', 'b'])
    const b = result.find(r => r.noteId === 'b')!
    expect(b.links).toHaveLength(2)
  })

  test('line numbers are 1-indexed and account for preceding newlines', () => {
    const notes = [makeNote({
      id: 'a', title: 'A',
      content: 'line one\nline two\nthird has [[Missing]] here',
    })]
    const result = findBrokenWikilinks(notes)
    expect(result[0].links[0].line).toBe(3)
  })

  test('whitespace inside [[ … ]] is trimmed before resolution', () => {
    const notes = [
      makeNote({ id: 'a', title: 'A', content: 'see [[  B  ]]' }),
      makeNote({ id: 'b', title: 'B' }),
    ]
    expect(findBrokenWikilinks(notes)).toEqual([])
  })
})
