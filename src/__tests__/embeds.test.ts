/**
 * embeds.test.ts
 *
 * Verifies the ![[Title]] transclusion expansion. Lookup goes through
 * findNoteByTitleOrAlias so we don't have to re-test alias resolution
 * here — just embedding behaviour, recursion + cycle handling.
 */

import { expandEmbeds, extractEmbedTitles, isImageEmbedTarget, MAX_EMBED_DEPTH } from '../utils/embeds'
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

describe('isImageEmbedTarget', () => {
  test.each([
    'a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.bmp', 'a.avif',
    'Pasted image 20260522191842.png',
  ])('%s is an image target', t => {
    expect(isImageEmbedTarget(t)).toBe(true)
  })

  test.each(['Some Note', 'a.md', 'note.txt', 'no-extension'])(
    '%s is NOT an image target',
    t => {
      expect(isImageEmbedTarget(t)).toBe(false)
    },
  )
})

describe('expandEmbeds — image embeds (Obsidian wiki images)', () => {
  test('`![[x.png]]` becomes an image, NOT a "no note found" callout', () => {
    const out = expandEmbeds('![[diagram.png]]', [])
    expect(out).toContain('![diagram.png](diagram.png)')
    expect(out).not.toContain('no note found')
  })

  test('resolver maps a bare filename to the stored attachment path', () => {
    const resolveAttachment = (t: string) =>
      t === 'Pasted image 20260522191842.png'
        ? 'Files/Pasted image 20260522191842.png'
        : null
    const out = expandEmbeds('![[Pasted image 20260522191842.png]]', [], {
      resolveAttachment,
    })
    // Path has spaces → angle-bracket destination so the markdown parser keeps
    // the literal path (spaces intact) for the downstream IDB lookup.
    expect(out).toBe(
      '![Pasted image 20260522191842.png](<Files/Pasted image 20260522191842.png>)',
    )
  })

  test('resolver hit wins even without an image extension', () => {
    // Some vaults store attachments without an extension in the embed; the
    // resolver recognising it as stored is enough to render as an image.
    const out = expandEmbeds('![[blob123]]', [], {
      resolveAttachment: t => (t === 'blob123' ? 'attachments/blob123' : null),
    })
    expect(out).toBe('![blob123](attachments/blob123)')
  })

  test('image embed with an alias uses the alias as alt text', () => {
    const out = expandEmbeds('![[diagram.png|My diagram]]', [])
    expect(out).toBe('![My diagram](diagram.png)')
  })

  test('resolveAttachment threads through recursion (image inside a transcluded note)', () => {
    const notes = [n('a', 'Host', 'intro\n![[pic.png]]')]
    const resolveAttachment = (t: string) =>
      t === 'pic.png' ? 'Files/pic.png' : null
    const out = expandEmbeds('![[Host]]', notes, { resolveAttachment })
    // The nested image embed resolves to its stored path inside the blockquote.
    expect(out).toContain('![pic.png](Files/pic.png)')
  })

  test('a real `![[note]]` still resolves as a note transclusion', () => {
    const notes = [n('a', 'Source', 'Hello world')]
    const out = expandEmbeds('![[Source]]', notes, {
      // Resolver returns null for non-attachments → falls through to note lookup.
      resolveAttachment: () => null,
    })
    expect(out).toContain('**📎 [[Source]]**')
    expect(out).toContain('> Hello world')
    expect(out).not.toContain('![Source]')
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
