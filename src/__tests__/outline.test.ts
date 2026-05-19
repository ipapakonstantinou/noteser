/**
 * outline.test.ts
 *
 * Unit tests for src/utils/outline.ts — pure parser, no mocks needed.
 */

import { extractHeadings } from '../utils/outline'

describe('extractHeadings', () => {
  test('empty string returns []', () => {
    expect(extractHeadings('')).toEqual([])
  })

  test('undefined-ish / falsy returns []', () => {
    expect(extractHeadings(undefined as unknown as string)).toEqual([])
  })

  test('content with no headings returns []', () => {
    const content = 'Just some prose.\nWith multiple lines.\nNo headings here.'
    expect(extractHeadings(content)).toEqual([])
  })

  test('single H1 at start', () => {
    expect(extractHeadings('# Title')).toEqual([
      { level: 1, text: 'Title', line: 1 },
    ])
  })

  test('six levels of headings, in order', () => {
    const content = [
      '# H1',
      '## H2',
      '### H3',
      '#### H4',
      '##### H5',
      '###### H6',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'H1', line: 1 },
      { level: 2, text: 'H2', line: 2 },
      { level: 3, text: 'H3', line: 3 },
      { level: 4, text: 'H4', line: 4 },
      { level: 5, text: 'H5', line: 5 },
      { level: 6, text: 'H6', line: 6 },
    ])
  })

  test('seven hashes is NOT a heading (max level is 6)', () => {
    expect(extractHeadings('####### nope')).toEqual([])
  })

  test('heading inside a fenced code block (```) is ignored', () => {
    const content = [
      '# Real heading',
      '```',
      '# fake heading inside fence',
      '## also fake',
      '```',
      '## Real again',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'Real heading', line: 1 },
      { level: 2, text: 'Real again', line: 6 },
    ])
  })

  test('heading inside a fenced code block (~~~) is ignored', () => {
    const content = [
      '~~~',
      '# inside tilde fence',
      '~~~',
      '# after fence',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'after fence', line: 4 },
    ])
  })

  test('language-tagged fence still hides headings inside it', () => {
    const content = [
      '# Pre',
      '```ts',
      '# const x = 1 // not a heading',
      '```',
      '# Post',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'Pre', line: 1 },
      { level: 1, text: 'Post', line: 5 },
    ])
  })

  test('unmatched fence char inside an open fence does NOT close it', () => {
    // Open with ``` (3 backticks). A ~~~ line should NOT close it.
    const content = [
      '```',
      '# hidden',
      '~~~',
      '# still hidden',
      '```',
      '# Now visible',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'Now visible', line: 6 },
    ])
  })

  test('indented `#` is NOT a heading (must be column 1)', () => {
    const content = [
      ' # leading space',
      '  ## two spaces',
      '\t# tab indent',
      '# proper',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'proper', line: 4 },
    ])
  })

  test('`## ` with empty text is ignored', () => {
    const content = [
      '## ',
      '## real',
      '# ',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 2, text: 'real', line: 2 },
    ])
  })

  test('`#` followed by non-space is not a heading (e.g. #tag)', () => {
    // A heading requires "#" + whitespace; "#tag" is a tag, not a heading.
    expect(extractHeadings('#tag and #another')).toEqual([])
  })

  test('setext-style underline headings are ignored (ATX only)', () => {
    const content = [
      'Title here',
      '==========',
      '',
      'Subtitle',
      '--------',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([])
  })

  test('mixed levels with content between, preserving line numbers', () => {
    const content = [
      'intro paragraph',  // 1
      '',                 // 2
      '# Main',           // 3
      'body',             // 4
      '',                 // 5
      '## Section A',     // 6
      'more body',        // 7
      '### Detail',       // 8
      '## Section B',     // 9
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'Main', line: 3 },
      { level: 2, text: 'Section A', line: 6 },
      { level: 3, text: 'Detail', line: 8 },
      { level: 2, text: 'Section B', line: 9 },
    ])
  })

  test('trailing hashes on a heading are stripped from the text', () => {
    // ATX spec: `## Heading ##` is a valid heading with text "Heading".
    expect(extractHeadings('## Heading ##')).toEqual([
      { level: 2, text: 'Heading', line: 1 },
    ])
  })

  test('heading text is trimmed of surrounding whitespace', () => {
    expect(extractHeadings('#   spaced out   ')).toEqual([
      { level: 1, text: 'spaced out', line: 1 },
    ])
  })

  test('two-backtick "fence" does NOT open a code block (needs ≥3)', () => {
    const content = [
      '``',
      '# still a heading',
      '``',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'still a heading', line: 2 },
    ])
  })

  test('longer-opening fence requires equal-or-longer closer', () => {
    // Opens with ````` (5). A 3-backtick line should NOT close it.
    const content = [
      '`````',
      '# inside',
      '```',
      '# still inside',
      '`````',
      '# outside',
    ].join('\n')
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: 'outside', line: 6 },
    ])
  })
})
