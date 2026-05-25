/**
 * imagesLivePreview.test.ts
 *
 * Verifies the StateField that swaps `![alt](attachments/...)` Image nodes
 * for an inline widget. Follows the tasksLivePreview test pattern: real
 * EditorState + the markdown parser, no DOM, mocked AttachmentImage so we
 * don't drag React stores in.
 */

// ── System-boundary mocks (before any import) ─────────────────────────────────

jest.mock('../components/editor/AttachmentImage', () => ({
  AttachmentImage: () => null,
  default: () => null,
}))

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  imagesLivePreview,
  imagesLivePreviewField,
  parseInlineImage,
} from '../components/editor/imagesLivePreview'
import { keys } from 'idb-keyval'
import { listAttachmentPaths, _clearAttachmentUrlCache } from '../utils/attachments'

const mockedKeys = keys as jest.MockedFunction<typeof keys>

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ base: markdownLanguage }),
      imagesLivePreview,
    ],
  })
}

interface DecoInfo {
  from: number
  to: number
  widget: { src?: string; alt?: string } | null
}

function collectDecos(state: EditorState): DecoInfo[] {
  const decos = state.field(imagesLivePreviewField)
  const result: DecoInfo[] = []
  const cursor = decos.iter()
  while (cursor.value !== null) {
    const w = cursor.value.spec?.widget as { src?: string; alt?: string } | undefined
    result.push({
      from: cursor.from,
      to: cursor.to,
      widget: w ? { src: w.src, alt: w.alt } : null,
    })
    cursor.next()
  }
  return result
}

// ── parseInlineImage ──────────────────────────────────────────────────────────

describe('parseInlineImage', () => {
  test('parses standard ![alt](src)', () => {
    expect(parseInlineImage('![hello](attachments/foo.png)'))
      .toEqual({ alt: 'hello', src: 'attachments/foo.png' })
  })

  test('parses empty alt text', () => {
    expect(parseInlineImage('![](attachments/foo.png)'))
      .toEqual({ alt: '', src: 'attachments/foo.png' })
  })

  test('rejects refs with whitespace in src', () => {
    expect(parseInlineImage('![x](attachments/foo bar.png)')).toBeNull()
  })

  test('rejects malformed refs', () => {
    expect(parseInlineImage('not an image')).toBeNull()
    expect(parseInlineImage('![alt](unterminated')).toBeNull()
    expect(parseInlineImage('[alt](attachments/foo.png)')).toBeNull()
  })

  test('parses a wiki image embed by extension (resolver returns null)', () => {
    // No index seeded → resolveAttachmentPath returns null; the image
    // extension alone makes it an image, src falls back to the bare target.
    expect(parseInlineImage('![[Pasted image 20260522.png]]'))
      .toEqual({ alt: 'Pasted image 20260522.png', src: 'Pasted image 20260522.png' })
  })

  test('wiki embed with alias uses the alias as alt text', () => {
    expect(parseInlineImage('![[diagram.png|My diagram]]'))
      .toEqual({ alt: 'My diagram', src: 'diagram.png' })
  })

  test('non-image wiki embed (note transclusion) is rejected', () => {
    expect(parseInlineImage('![[Some Note]]')).toBeNull()
  })
})

// ── imagesLivePreviewField ────────────────────────────────────────────────────

describe('imagesLivePreviewField StateField', () => {

  test('empty document produces no decorations', () => {
    const state = makeState('')
    expect(collectDecos(state)).toHaveLength(0)
  })

  test('attachment image on its own line gets a widget when cursor is elsewhere', () => {
    // line 1: "intro"                                  pos 0–5
    // line 2: ""                                       pos 6–6
    // line 3: "![pic](attachments/foo.png)"            pos 7–33
    const doc = 'intro\n\n![pic](attachments/foo.png)\n'
    const state = makeState(doc, 0) // cursor on line 1
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    expect(decos[0].widget?.src).toBe('attachments/foo.png')
    expect(decos[0].widget?.alt).toBe('pic')
  })

  test('cursor on the image line suppresses the widget (raw-edit mode)', () => {
    const doc = '![pic](attachments/foo.png)\n'
    // Cursor at pos 5 → line 1 → on the image's line → no decoration.
    const state = makeState(doc, 5)
    expect(collectDecos(state)).toHaveLength(0)
  })

  test('external URLs (http) are left alone', () => {
    const doc = '![logo](https://example.com/logo.png)\n'
    const state = makeState(doc, doc.length - 1) // cursor far from image line? No, only one line.
    // Actually with a single-line doc, the cursor is necessarily on the image
    // line — but the rule says external URLs are skipped regardless.
    expect(collectDecos(state)).toHaveLength(0)

    // Also with a multiline doc + cursor off-line, external still skipped:
    const doc2 = 'intro\n\n![logo](https://example.com/logo.png)\n'
    const state2 = makeState(doc2, 0)
    expect(collectDecos(state2)).toHaveLength(0)
  })

  test('wiki image embed resolved to a stored Files/ path gets a widget', async () => {
    // Seed the sync attachment index from a mocked IDB scan: the bare embed
    // name resolves to the stored `Files/...` path even though that folder
    // isn't the configured attachments folder.
    _clearAttachmentUrlCache()
    mockedKeys.mockResolvedValueOnce([
      'noteser-attachment:Files/Pasted image 20260522.png',
    ])
    await listAttachmentPaths()

    const doc = 'intro\n\n![[Pasted image 20260522.png]]\n'
    const state = makeState(doc, 0) // cursor on line 1
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    expect(decos[0].widget?.src).toBe('Files/Pasted image 20260522.png')
    _clearAttachmentUrlCache()
  })

  test('multiple attachments produce one decoration each', () => {
    const doc = [
      'top',
      '',
      '![a](attachments/a.png)',
      '',
      '![b](attachments/b.png)',
      '',
    ].join('\n')
    const state = makeState(doc, 0)
    const decos = collectDecos(state)
    expect(decos).toHaveLength(2)
    expect(decos.map(d => d.widget?.src)).toEqual([
      'attachments/a.png',
      'attachments/b.png',
    ])
  })
})
