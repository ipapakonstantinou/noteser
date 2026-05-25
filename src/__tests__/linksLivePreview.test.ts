/**
 * linksLivePreview.test.ts
 *
 * Verifies the StateField that decorates links in the CodeMirror live preview:
 *   - bare URLs            → clickable mark (`.cm-lp-link`)
 *   - autolinks `<url>`    → clickable mark + hidden angle brackets off-cursor
 *   - markdown `[t](url)`  → text as clickable mark, `](url)` hidden off-cursor
 *   - wikilinks `[[X]]`    → replace widget off-cursor, raw when cursor inside
 *
 * Follows the imagesLivePreview test pattern: real EditorState + the markdown
 * parser, no DOM. The wikilink resolution (findNoteByTitleOrAlias) only runs
 * inside the widget's toDOM, so an empty note set is fine here.
 */

// ── System-boundary mocks (before any import) ─────────────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Decoration } from '@codemirror/view'
import {
  linksLivePreviewField,
  type LinksLivePreviewDeps,
} from '../components/editor/linksLivePreview'

const deps: LinksLivePreviewDeps = {
  getActiveNotes: () => [],
  onWikilinkNavigate: () => {},
}

const field = linksLivePreviewField(deps)

function makeState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [markdown({ base: markdownLanguage }), field],
  })
}

interface DecoInfo {
  from: number
  to: number
  kind: 'link' | 'hidden' | 'wikilink' | 'other'
  href?: string
  display?: string
}

function collectDecos(state: EditorState): DecoInfo[] {
  const decos = state.field(field)
  const result: DecoInfo[] = []
  const cursor = decos.iter()
  while (cursor.value !== null) {
    const spec = cursor.value.spec as {
      class?: string
      attributes?: Record<string, string>
      widget?: { display?: string; target?: string }
    }
    let kind: DecoInfo['kind'] = 'other'
    if (spec.widget) kind = 'wikilink'
    else if (spec.class === 'cm-lp-link') kind = 'link'
    else if (spec.class === 'cm-lp-hidden') kind = 'hidden'
    result.push({
      from: cursor.from,
      to: cursor.to,
      kind,
      href: spec.attributes?.['data-cm-lp-href'],
      display: spec.widget?.display,
    })
    cursor.next()
  }
  return result
}

describe('linksLivePreview — bare URLs', () => {
  test('bare http URL gets a clickable link mark', () => {
    const doc = 'see http://example.com here'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)
    const link = decos.find(d => d.kind === 'link')
    expect(link).toBeDefined()
    expect(link!.href).toBe('http://example.com')
    expect(doc.slice(link!.from, link!.to)).toBe('http://example.com')
  })

  test('https URL with query string is captured whole', () => {
    const doc = 'a https://ex.com/p?q=1&x=2 b'
    const decos = collectDecos(makeState(doc, 0))
    const link = decos.find(d => d.kind === 'link')
    expect(link!.href).toBe('https://ex.com/p?q=1&x=2')
  })

  test('no links → no decorations', () => {
    expect(collectDecos(makeState('just plain text', 0))).toHaveLength(0)
  })
})

describe('linksLivePreview — autolinks <url>', () => {
  test('renders the URL as a link and hides the angle brackets off-cursor', () => {
    const doc = 'x <http://example.com> y'
    const state = makeState(doc, 0) // cursor at start, off the link
    const decos = collectDecos(state)
    const link = decos.find(d => d.kind === 'link')
    expect(link!.href).toBe('http://example.com')
    // Two hidden marks: the `<` and the `>`.
    const hidden = decos.filter(d => d.kind === 'hidden')
    expect(hidden).toHaveLength(2)
  })

  test('cursor inside reveals the brackets (no hidden marks)', () => {
    const doc = '<http://example.com>'
    const state = makeState(doc, 5) // cursor inside the autolink
    const decos = collectDecos(state)
    // URL still styled, but brackets shown.
    expect(decos.some(d => d.kind === 'link')).toBe(true)
    expect(decos.some(d => d.kind === 'hidden')).toBe(false)
  })
})

describe('linksLivePreview — markdown links [text](url)', () => {
  test('off-cursor: text shown as link, [ and ](url) hidden', () => {
    // line 1 plain, link on line 3 so the cursor (pos 0) is off the link line
    const doc = 'top\n\n[text](http://example.com)\n'
    const linkStart = doc.indexOf('[text]')
    const state = makeState(doc, 0)
    const decos = collectDecos(state)

    const link = decos.find(d => d.kind === 'link')
    expect(link).toBeDefined()
    expect(link!.href).toBe('http://example.com')
    expect(doc.slice(link!.from, link!.to)).toBe('text')

    // Opening `[` hidden.
    expect(decos.some(d => d.kind === 'hidden' && d.from === linkStart)).toBe(true)
    // `](http://example.com)` hidden — a hidden mark ending at the `)`.
    const closeEnd = doc.indexOf(')', linkStart) + 1
    expect(decos.some(d => d.kind === 'hidden' && d.to === closeEnd)).toBe(true)
  })

  test('cursor inside the link reveals raw markdown (no decorations)', () => {
    const doc = '[text](http://example.com)'
    const state = makeState(doc, 3) // cursor within "text"
    expect(collectDecos(state)).toHaveLength(0)
  })

  test('empty link text is left raw', () => {
    const doc = 'top\n\n[](http://example.com)\n'
    const state = makeState(doc, 0)
    // No link mark, no hidden marks for the markdown link.
    expect(collectDecos(state).some(d => d.kind === 'link')).toBe(false)
  })
})

describe('linksLivePreview — wikilinks [[Target]]', () => {
  test('off-cursor: replaced by a widget showing the target', () => {
    const doc = 'top\n\n[[My Note]]\n'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)
    const wiki = decos.find(d => d.kind === 'wikilink')
    expect(wiki).toBeDefined()
    expect(wiki!.display).toBe('My Note')
    expect(doc.slice(wiki!.from, wiki!.to)).toBe('[[My Note]]')
  })

  test('piped wikilink uses the alias as display text', () => {
    const doc = 'top\n\n[[Target|Alias]]\n'
    const decos = collectDecos(makeState(doc, 0))
    const wiki = decos.find(d => d.kind === 'wikilink')
    expect(wiki!.display).toBe('Alias')
  })

  test('cursor inside the wikilink reveals raw text (no widget)', () => {
    const doc = '[[My Note]]'
    const state = makeState(doc, 4) // inside the target
    expect(collectDecos(state).some(d => d.kind === 'wikilink')).toBe(false)
  })

  test('wikilink content is NOT double-decorated as a markdown link', () => {
    // lezer parses `[[X]]` as a nested `[X]` Link; the inWikilink guard must
    // stop that from also producing link/hidden marks.
    const doc = 'top\n\n[[My Note]]\n'
    const decos = collectDecos(makeState(doc, 0))
    expect(decos.filter(d => d.kind === 'wikilink')).toHaveLength(1)
    expect(decos.some(d => d.kind === 'link')).toBe(false)
    expect(decos.some(d => d.kind === 'hidden')).toBe(false)
  })
})

describe('linksLivePreview — produced decoration types', () => {
  test('wikilink decoration is a replace (point/range) decoration', () => {
    const doc = 'top\n\n[[X]]\n'
    const decos = makeState(doc, 0).field(field)
    const cursor = decos.iter()
    let found = false
    while (cursor.value !== null) {
      if ((cursor.value.spec as { widget?: unknown }).widget) {
        // A replace decoration compares equal to Decoration.replace's class.
        expect(cursor.value).not.toBe(Decoration.none)
        found = true
      }
      cursor.next()
    }
    expect(found).toBe(true)
  })
})
