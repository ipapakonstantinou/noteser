/**
 * backlinks.test.ts
 *
 * Covers findBacklinks() — the pure scanner that finds every note whose body
 * contains a `[[Title]]` / `[[Alias]]` / `[[Title|Display]]` wikilink to a
 * target note.
 */

import { findBacklinks } from '../utils/backlinks'
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
  // Alias parsing is memoised; clear it so each test starts fresh.
  _clearAliasCache()
})

describe('findBacklinks', () => {
  test('no notes link to target → []', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const others = [
      makeNote({ id: 'a', title: 'A', content: 'nothing here' }),
      makeNote({ id: 'b', title: 'B', content: 'a [[different]] link' }),
    ]
    expect(findBacklinks([target, ...others], target)).toEqual([])
  })

  test('single linking note → one entry with one snippet', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'See also [[Target]] for context.',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].noteId).toBe('a')
    expect(result[0].title).toBe('A')
    expect(result[0].snippets).toHaveLength(1)
    expect(result[0].snippets[0].line).toBe(1)
    expect(result[0].snippets[0].text).toContain('[[Target]]')
  })

  test('multiple links in same note → snippets array capped at 3', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const body = [
      'one [[Target]] alpha',
      'two [[Target]] beta',
      'three [[Target]] gamma',
      'four [[Target]] delta',
      'five [[Target]] epsilon',
    ].join('\n')
    const linker = makeNote({ id: 'a', title: 'A', content: body })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].snippets).toHaveLength(3)
    // Lines should be 1, 2, 3 — i.e. the first three occurrences.
    expect(result[0].snippets.map(s => s.line)).toEqual([1, 2, 3])
  })

  test('two-occurrence note → snippets length == 2 (min(occurrences, 3))', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'first [[Target]] then later [[Target]] again',
    })
    const result = findBacklinks([target, linker], target)
    expect(result[0].snippets).toHaveLength(2)
  })

  test('alias match — target declares aliases, link uses one', () => {
    const target = makeNote({
      id: 't',
      title: 'Target',
      content: `---\naliases: [Short, "Even Shorter"]\n---\nBody`,
    })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'Go read [[Short]] later',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].noteId).toBe('a')
    expect(result[0].snippets[0].text).toContain('[[Short]]')
  })

  test('pipe display — [[Target|see this]] matches on the Title portion', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'Click [[Target|see this]] for details',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].snippets[0].text).toContain('[[Target|see this]]')
  })

  test('case-insensitive title match', () => {
    const target = makeNote({ id: 't', title: 'Project Apollo' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'see [[project apollo]] and [[PROJECT APOLLO]]',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].snippets).toHaveLength(2)
  })

  test('code-block-wrapped [[Target]] is still counted (v1 behaviour)', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: '```\nexample: [[Target]]\n```',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    expect(result[0].snippets[0].text).toContain('[[Target]]')
  })

  test('deleted notes are excluded as linkers', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'links to [[Target]]',
      isDeleted: true,
      deletedAt: 1,
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toEqual([])
  })

  test('target note itself is excluded (self-link does not count)', () => {
    const target = makeNote({
      id: 't',
      title: 'Target',
      content: 'I am [[Target]] referencing myself',
    })
    expect(findBacklinks([target], target)).toEqual([])
  })

  test('multiple linking notes → multiple entries, target excluded from output', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const a = makeNote({ id: 'a', title: 'A', content: 'hi [[Target]]' })
    const b = makeNote({ id: 'b', title: 'B', content: 'also [[Target]]' })
    const c = makeNote({ id: 'c', title: 'C', content: 'no link here' })
    const result = findBacklinks([target, a, b, c], target)
    expect(result.map(r => r.noteId).sort()).toEqual(['a', 'b'])
  })

  test('snippet text is roughly bounded to ~120 chars with ellipses', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const padding = 'x'.repeat(200)
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: `${padding} [[Target]] ${padding}`,
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
    const text = result[0].snippets[0].text
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toContain('[[Target]]')
    // ~120 chars of context + the match + two ellipses. Looser upper bound so
    // small implementation drift doesn't flake the test.
    expect(text.length).toBeLessThanOrEqual(160)
  })

  test('line number is 1-indexed and counts newlines correctly', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'line one\nline two\nthird has [[Target]] here',
    })
    const result = findBacklinks([target, linker], target)
    expect(result[0].snippets[0].line).toBe(3)
  })

  test('whitespace inside [[ … ]] is trimmed before matching', () => {
    const target = makeNote({ id: 't', title: 'Target' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'padding [[  Target  ]] more',
    })
    const result = findBacklinks([target, linker], target)
    expect(result).toHaveLength(1)
  })

  test('empty/whitespace-only title with no aliases → []', () => {
    const target = makeNote({ id: 't', title: '   ' })
    const linker = makeNote({
      id: 'a',
      title: 'A',
      content: 'has [[whatever]] link',
    })
    expect(findBacklinks([target, linker], target)).toEqual([])
  })
})
