/**
 * embeds.test.ts
 *
 * Verifies the ![[Title]] transclusion expansion. Lookup goes through
 * findNoteByTitleOrAlias so we don't have to re-test alias resolution
 * here — just embedding behaviour, recursion + cycle handling.
 */

import { expandEmbeds, extractEmbedTitles, MAX_EMBED_DEPTH } from '../utils/embeds'
import type { Note } from '@/types'

function n(id: string, title: string, content: string): Note {
  return {
    id,
    title,
    content,
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
  } as Note
}

describe('expandEmbeds — single level', () => {
  test('expands a single ![[Title]] reference into a blockquote', () => {
    const notes = [n('a', 'Source', 'Hello world')]
    const out = expandEmbeds('Before\n![[Source]]\nAfter', notes)
    expect(out).toContain('Before')
    expect(out).toContain('After')
    expect(out).toContain('**📎 [[Source]]**')
    expect(out).toContain('> Hello world')
  })

  test('blockquotes every line of the embedded body', () => {
    const notes = [n('a', 'Multi', 'line1\nline2\n\nline4')]
    const out = expandEmbeds('![[Multi]]', notes)
    expect(out).toContain('> line1')
    expect(out).toContain('> line2')
    expect(out).toContain('> line4')
  })

  test('shows a "no note found" callout for unresolved titles', () => {
    const out = expandEmbeds('![[Missing]]', [])
    expect(out).toContain('no note found')
    expect(out).not.toContain('![[Missing]]')
  })

  test('`![[]]` with no inner title is left as plain text (regex requires a body)', () => {
    expect(expandEmbeds('![[]]', [])).toBe('![[]]')
  })

  test('content with no embeds passes through unchanged', () => {
    expect(expandEmbeds('plain text', [])).toBe('plain text')
  })

  test('resolves via alias lookup (delegates to findNoteByTitleOrAlias)', () => {
    // Note's frontmatter declares aliases: [Shortcut]
    const note = n(
      'a',
      'Long winded title',
      '---\naliases: [Shortcut]\n---\nbody',
    )
    const out = expandEmbeds('![[Shortcut]]', [note])
    expect(out).toContain('**📎 [[Long winded title]]**')
  })
})

describe('expandEmbeds — recursion', () => {
  test('embeds inside embeds expand transitively', () => {
    const notes = [
      n('a', 'Outer', 'Outer body\n![[Inner]]'),
      n('b', 'Inner', 'Inner body'),
    ]
    const out = expandEmbeds('![[Outer]]', notes)
    expect(out).toContain('Outer body')
    expect(out).toContain('Inner body')
  })

  test('cycle A → B → A is broken with a circular-embed callout', () => {
    const notes = [
      n('a', 'A', '![[B]]'),
      n('b', 'B', '![[A]]'),
    ]
    const out = expandEmbeds('![[A]]', notes)
    // Outer is A; B inside expands; the second A triggers cycle detection.
    expect(out).toContain('circular embed')
  })

  test('self-embed A → A is broken with circular-embed callout', () => {
    const notes = [n('a', 'Self', 'before\n![[Self]]\nafter')]
    const out = expandEmbeds('![[Self]]', notes)
    expect(out).toContain('before')
    expect(out).toContain('circular embed')
  })

  test('depth cap kicks in past MAX_EMBED_DEPTH', () => {
    // Build a chain N0 → N1 → N2 → … each embedding the next. With a low
    // maxDepth of 2 the third nesting should be replaced with a depth-cap
    // callout.
    const notes: Note[] = []
    for (let i = 0; i < 6; i++) {
      notes.push(n(`n${i}`, `N${i}`, `body ${i}\n![[N${i + 1}]]`))
    }
    notes.push(n('end', 'N6', 'tail'))
    const out = expandEmbeds('![[N0]]', notes, { maxDepth: 2 })
    expect(out).toContain('embed too deep')
    // We stopped before reaching the tail.
    expect(out).not.toContain('tail')
  })

  test('default MAX_EMBED_DEPTH is 4', () => {
    expect(MAX_EMBED_DEPTH).toBe(4)
  })
})

describe('extractEmbedTitles', () => {
  test('returns every embed title in document order', () => {
    expect(extractEmbedTitles('top\n![[A]]\nmid\n![[B|nope]]\nend'))
      .toEqual(['A', 'B'])
  })

  test('returns an empty array when there are no embeds', () => {
    expect(extractEmbedTitles('plain text [[link]] not an embed')).toEqual([])
  })

  test('strips surrounding whitespace from the title', () => {
    expect(extractEmbedTitles('![[ Padded ]]')).toEqual(['Padded'])
  })
})
