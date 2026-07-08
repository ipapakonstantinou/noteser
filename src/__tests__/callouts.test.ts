/**
 * callouts.test.ts
 *
 * GitHub-style alert blockquotes (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
 * `> [!WARNING]`, `> [!CAUTION]`). matchCalloutType is the single-line marker
 * regex; applyCalloutToBlockquote is the mdast-node mutation the remark
 * plugin (remarkCallouts.ts) delegates to. Tested directly, without going
 * through a real unified/remark-parse pipeline — Jest can't transform
 * react-markdown/remark's ESM output (see previewTaskDone.test.tsx), so we
 * hand-build minimal mdast shapes instead, mirroring taskListItem.test.ts's
 * hand-built HAST shapes.
 */

import {
  matchCalloutType,
  applyCalloutToBlockquote,
  CALLOUT_TYPES,
  CALLOUT_LABELS,
  CALLOUT_ICON_SHAPES,
  CALLOUT_STYLES,
  type MdastBlockquoteNode,
} from '../utils/callouts'

// ── mdast builders ────────────────────────────────────────────────────────────

const text = (value: string) => ({ type: 'text' as const, value })

const blockquote = (firstParagraphText: string, extraChildren: Record<string, unknown>[] = []): MdastBlockquoteNode => ({
  type: 'blockquote',
  children: [
    { type: 'paragraph', children: [text(firstParagraphText)] },
    ...extraChildren,
  ],
})

describe('matchCalloutType', () => {
  test.each(CALLOUT_TYPES)('recognises [!%s] (uppercase, canonical form)', (type) => {
    expect(matchCalloutType(`[!${type.toUpperCase()}]`)).toBe(type)
  })

  test('is case-insensitive (lowercase and mixed case)', () => {
    expect(matchCalloutType('[!note]')).toBe('note')
    expect(matchCalloutType('[!WaRnInG]')).toBe('warning')
  })

  test('tolerates trailing whitespace', () => {
    expect(matchCalloutType('[!TIP]   ')).toBe('tip')
  })

  test('rejects a marker that is not alone on the line', () => {
    expect(matchCalloutType('[!NOTE] some trailing text')).toBeNull()
    expect(matchCalloutType('See [!NOTE] for details.')).toBeNull()
  })

  test('rejects an unknown alert type', () => {
    expect(matchCalloutType('[!DANGER]')).toBeNull()
  })

  test('rejects plain text', () => {
    expect(matchCalloutType('Just a regular quote.')).toBeNull()
  })
})

describe('applyCalloutToBlockquote', () => {
  test.each(CALLOUT_TYPES)('detects a %s callout and tags the node', (type) => {
    const node = blockquote(`[!${type.toUpperCase()}]\nBody text.`)
    const result = applyCalloutToBlockquote(node)
    expect(result).toBe(type)
    expect(node.data?.hProperties).toMatchObject({
      className: ['callout', `callout-${type}`],
      'data-callout': type,
    })
  })

  test('strips the marker line from the paragraph, leaving the body', () => {
    const node = blockquote('[!NOTE]\nUseful information.')
    applyCalloutToBlockquote(node)
    const para = node.children[0] as { children: Array<{ value: string }> }
    expect(para.children[0].value).toBe('Useful information.')
  })

  test('marker alone (no body on the same paragraph) removes the now-empty text node', () => {
    const node = blockquote('[!NOTE]')
    applyCalloutToBlockquote(node)
    const para = node.children[0] as { children: unknown[] }
    expect(para.children).toEqual([])
  })

  test('is case-insensitive', () => {
    const node = blockquote('[!warning]\nHeads up.')
    expect(applyCalloutToBlockquote(node)).toBe('warning')
  })

  test('leaves an ordinary blockquote untouched', () => {
    const node = blockquote('Just a regular quote.')
    const result = applyCalloutToBlockquote(node)
    expect(result).toBeNull()
    expect(node.data).toBeUndefined()
    const para = node.children[0] as { children: Array<{ value: string }> }
    expect(para.children[0].value).toBe('Just a regular quote.')
  })

  test('leaves a blockquote whose first paragraph does not open with a text node untouched', () => {
    const node: MdastBlockquoteNode = {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: [{ type: 'strong', children: [text('[!NOTE]')] }] }],
    }
    expect(applyCalloutToBlockquote(node)).toBeNull()
  })

  test('a blockquote nested inside another block (e.g. a list item) is still detected — detection is local to the node', () => {
    // remarkCallouts (unist-util-visit) walks every blockquote in the tree
    // regardless of ancestry; simulate a listItem > blockquote nesting by
    // just calling the function on the nested node directly.
    const listItem = {
      type: 'listItem',
      children: [blockquote('[!TIP]\nNested callout inside a list item.')],
    }
    const nested = listItem.children[0]
    const result = applyCalloutToBlockquote(nested)
    expect(result).toBe('tip')
    expect(nested.data?.hProperties).toMatchObject({ 'data-callout': 'tip' })
  })

  test('does not clobber pre-existing hProperties on the node', () => {
    const node = blockquote('[!CAUTION]\nBody.')
    node.data = { hProperties: { id: 'kept' } }
    applyCalloutToBlockquote(node)
    expect(node.data.hProperties).toMatchObject({ id: 'kept', 'data-callout': 'caution' })
  })
})

describe('icon/label/style tables cover all five types', () => {
  test.each(CALLOUT_TYPES)('%s has a label, icon shapes, and a color style', (type) => {
    expect(CALLOUT_LABELS[type]).toBeTruthy()
    expect(CALLOUT_ICON_SHAPES[type].length).toBeGreaterThan(0)
    expect(CALLOUT_STYLES[type].border).toMatch(/^border-/)
    expect(CALLOUT_STYLES[type].text).toMatch(/^text-/)
    expect(CALLOUT_STYLES[type].bg).toMatch(/^bg-/)
  })

  test('every type has a visually distinct color', () => {
    const colors = CALLOUT_TYPES.map((t) => CALLOUT_STYLES[t].text)
    expect(new Set(colors).size).toBe(CALLOUT_TYPES.length)
  })
})
