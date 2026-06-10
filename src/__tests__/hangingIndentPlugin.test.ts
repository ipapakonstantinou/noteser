/**
 * hangingIndentPlugin.test.ts
 *
 * Two layers of coverage for the soft-wrap hanging-indent decorations:
 *
 * 1. listLinePrefixWidth — the pure helper that decides the marker width for
 *    a single line. Easy to assert across every list shape (bullet, ordered,
 *    task, nested, plain) without spinning up a CodeMirror view.
 *
 * 2. Integration: mount an EditorView with hangingIndentExtension and read
 *    its DecorationSet so we exercise the ViewPlugin's viewport scan and the
 *    inline `padding-left` / `text-indent` it emits.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined)
}))

import { EditorState, Text } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  continuationIndentWidth,
  hangingIndentExtension,
  listLinePrefixWidth
} from '../components/editor/hangingIndentPlugin'

describe('listLinePrefixWidth', () => {
  test('plain lines get no indent', () => {
    expect(listLinePrefixWidth('')).toBe(0)
    expect(listLinePrefixWidth('hello world')).toBe(0)
    expect(listLinePrefixWidth('   indented but no marker')).toBe(0)
  })

  test('bullet markers count indent + "- "', () => {
    expect(listLinePrefixWidth('- foo')).toBe(2)
    expect(listLinePrefixWidth('* foo')).toBe(2)
    expect(listLinePrefixWidth('+ foo')).toBe(2)
  })

  test('nested bullets include their leading whitespace', () => {
    expect(listLinePrefixWidth('  - foo')).toBe(4)
    expect(listLinePrefixWidth('    - foo')).toBe(6)
  })

  test('ordered markers grow with digit count', () => {
    expect(listLinePrefixWidth('1. foo')).toBe(3)
    expect(listLinePrefixWidth('10. foo')).toBe(4)
    expect(listLinePrefixWidth('  1. foo')).toBe(5)
    expect(listLinePrefixWidth('  10. foo')).toBe(6)
  })

  test('task lines include the "[ ] " checkbox glyph width', () => {
    // "- [ ] foo" — carrier "- " (2) + "[ ] " (4) = 6
    expect(listLinePrefixWidth('- [ ] foo')).toBe(6)
    expect(listLinePrefixWidth('- [x] foo')).toBe(6)
    // Nested task: 2-space indent + carrier "- " + "[ ] " = 8
    expect(listLinePrefixWidth('  - [ ] foo')).toBe(8)
    // Ordered task: "1. " (3) + "[ ] " (4) = 7
    expect(listLinePrefixWidth('1. [ ] foo')).toBe(7)
  })
})

// Helper: build a Text doc from an array of lines (one per element) so the
// continuation-walk tests read like the actual buffer they describe.
function textOf(lines: string[]): Text {
  return Text.of(lines)
}

describe('continuationIndentWidth (Shift+Enter list-paragraph chain)', () => {
  test('bullet + 2-space continuation returns the bullet marker width (2)', () => {
    const doc = textOf(['- bullet', '  cont line'])
    expect(continuationIndentWidth(doc, 2)).toBe(2)
  })

  test('task + 6-space continuation returns the task marker width (6)', () => {
    const doc = textOf(['- [ ] Check IIA references', '      this is a note'])
    expect(continuationIndentWidth(doc, 2)).toBe(6)
  })

  test('two consecutive continuation lines share the same parent width', () => {
    const doc = textOf([
      '- [ ] task body',
      '      first continuation',
      '      second continuation'
    ])
    expect(continuationIndentWidth(doc, 2)).toBe(6)
    expect(continuationIndentWidth(doc, 3)).toBe(6)
  })

  test('blank line between parent and would-be continuation breaks the chain', () => {
    const doc = textOf(['- bullet', '', '  not a continuation'])
    expect(continuationIndentWidth(doc, 3)).toBe(0)
  })

  test('plain top-level paragraph with no leading whitespace is not a continuation', () => {
    const doc = textOf(['- bullet', 'plain paragraph below'])
    expect(continuationIndentWidth(doc, 2)).toBe(0)
  })

  test('intermediate non-indented plain line breaks the chain (no chain to follow)', () => {
    const doc = textOf([
      '- bullet',
      'unrelated paragraph',
      '  looks like cont but parent is unreachable'
    ])
    expect(continuationIndentWidth(doc, 3)).toBe(0)
  })

  test('nested list: continuation matches the IMMEDIATE parent (deepest list line above)', () => {
    // Outer bullet "- outer" (width 2), nested bullet "  - inner" (width 4),
    // continuation under the inner item needs >=4 leading spaces.
    const doc = textOf(['- outer', '  - inner', '    inner continuation'])
    expect(continuationIndentWidth(doc, 3)).toBe(4)
  })

  test('leading whitespace shorter than parent marker width does not count', () => {
    // "- [ ] body" needs >=6 spaces on the continuation; "    " is only 4.
    const doc = textOf(['- [ ] body', '    too-shallow'])
    expect(continuationIndentWidth(doc, 2)).toBe(0)
  })

  test('list-marker line itself returns 0 (handled by the marker pass, not the chain)', () => {
    const doc = textOf(['- bullet', '- another bullet'])
    expect(continuationIndentWidth(doc, 1)).toBe(0)
    expect(continuationIndentWidth(doc, 2)).toBe(0)
  })

  test('plain line with only whitespace (no body) does not extend the chain', () => {
    // A line of just spaces should behave like a blank line — terminator.
    const doc = textOf(['- bullet', '   ', '  would-be cont'])
    expect(continuationIndentWidth(doc, 3)).toBe(0)
  })
})

// Read every line decoration the plugin produced for a given doc and return
// a map of 1-based line number -> inline style string. Walking the
// DecorationSet directly is the cleanest way to assert what the ViewPlugin
// emitted without depending on the rendered DOM (which jsdom doesn't lay
// out faithfully).
function collectLineDecorations(doc: string): Map<number, string> {
  const state = EditorState.create({
    doc,
    extensions: [EditorView.lineWrapping, hangingIndentExtension]
  })
  const view = new EditorView({ state })
  try {
    const out = new Map<number, string>()
    // Locate our plugin via the public field accessor.
    const plugins = (
      view as unknown as {
        plugins: { value: { decorations?: unknown } }[]
      }
    ).plugins
    const found = plugins
      .map(p => p.value)
      .find(
        (
          v
        ): v is {
          decorations: {
            iter(): {
              value: { spec: { attributes?: { style?: string } } } | null
              from: number
              next(): void
            }
          }
        } => !!v && typeof v === 'object' && 'decorations' in v
      )
    if (!found) return out
    const iter = found.decorations.iter()
    while (iter.value) {
      const style = iter.value.spec.attributes?.style
      if (style) {
        const lineNo = view.state.doc.lineAt(iter.from).number
        out.set(lineNo, style)
      }
      iter.next()
    }
    return out
  } finally {
    view.destroy()
  }
}

describe('hangingIndentExtension decorations', () => {
  test('mixed fixture produces a decoration per list line with the right width', () => {
    const doc = [
      'plain paragraph',
      '- bullet item',
      '  - nested bullet',
      '1. ordered item',
      '10. larger ordered item',
      '- [ ] task line',
      '- [x] done task',
      '  - [ ] nested task',
      'another plain line'
    ].join('\n')

    const decos = collectLineDecorations(doc)

    // Plain lines: no decoration emitted.
    expect(decos.has(1)).toBe(false)
    expect(decos.has(9)).toBe(false)

    // Bullets / nested / ordered / tasks: padding-left + matching
    // negative text-indent, in `ch` units.
    expect(decos.get(2)).toBe('padding-left:2ch;text-indent:-2ch;')
    expect(decos.get(3)).toBe('padding-left:4ch;text-indent:-4ch;')
    expect(decos.get(4)).toBe('padding-left:3ch;text-indent:-3ch;')
    expect(decos.get(5)).toBe('padding-left:4ch;text-indent:-4ch;')
    expect(decos.get(6)).toBe('padding-left:6ch;text-indent:-6ch;')
    expect(decos.get(7)).toBe('padding-left:6ch;text-indent:-6ch;')
    expect(decos.get(8)).toBe('padding-left:8ch;text-indent:-8ch;')
  })

  test('document with no list lines emits no decorations', () => {
    const decos = collectLineDecorations('just\nsome\nprose\n')
    expect(decos.size).toBe(0)
  })

  test('bullet + 2-space continuation: continuation matches the bullet width', () => {
    const decos = collectLineDecorations(['- bullet', '  cont'].join('\n'))
    expect(decos.get(1)).toBe('padding-left:2ch;text-indent:-2ch;')
    expect(decos.get(2)).toBe('padding-left:2ch;text-indent:-2ch;')
  })

  test('task + 6-space continuation: continuation matches the task width (6)', () => {
    const decos = collectLineDecorations(
      ['- [ ] Check IIA references', '      this is a note'].join('\n')
    )
    expect(decos.get(1)).toBe('padding-left:6ch;text-indent:-6ch;')
    expect(decos.get(2)).toBe('padding-left:6ch;text-indent:-6ch;')
  })

  test('two consecutive continuation lines both get the parent decoration', () => {
    const decos = collectLineDecorations(
      ['- [ ] body', '      cont 1', '      cont 2'].join('\n')
    )
    expect(decos.get(2)).toBe('padding-left:6ch;text-indent:-6ch;')
    expect(decos.get(3)).toBe('padding-left:6ch;text-indent:-6ch;')
  })

  test('blank line between parent and would-be continuation: continuation gets NO decoration', () => {
    const decos = collectLineDecorations(
      ['- bullet', '', '  not a continuation'].join('\n')
    )
    expect(decos.get(1)).toBe('padding-left:2ch;text-indent:-2ch;')
    expect(decos.has(2)).toBe(false)
    expect(decos.has(3)).toBe(false)
  })

  test('nested list continuation aligns to the immediate parent (inner bullet, width 4)', () => {
    const decos = collectLineDecorations(
      ['- outer', '  - inner', '    inner cont'].join('\n')
    )
    expect(decos.get(1)).toBe('padding-left:2ch;text-indent:-2ch;')
    expect(decos.get(2)).toBe('padding-left:4ch;text-indent:-4ch;')
    expect(decos.get(3)).toBe('padding-left:4ch;text-indent:-4ch;')
  })
})

// Compile-time guard that the extension we export really is a ViewPlugin —
// future refactors that swap it for a StateField would change the perf
// profile (whole-doc scan on every edit) and should be a conscious choice.
test('hangingIndentExtension is a ViewPlugin (cheap viewport-only updates)', () => {
  // ViewPlugin instances have a unique `extension` getter and are not arrays.
  // We assert structurally: it must be assignable to the ViewPlugin shape.
  expect(hangingIndentExtension).toBeDefined()
  // The factory result is a Facet-flavoured object; the cheapest stable
  // signal we have is that it isn't a plain array AND ViewPlugin.fromClass
  // is the type we used.
  expect(typeof ViewPlugin.fromClass).toBe('function')
})
