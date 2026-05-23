import { getActiveTagQuery } from '../utils/tagAutocomplete'

describe('getActiveTagQuery', () => {
  test('returns the partial query when cursor is right after #foo', () => {
    const content = 'hello #foo'
    const r = getActiveTagQuery(content, content.length)
    expect(r).toEqual({ query: 'foo', start: 6 })
  })

  test('returns empty query when cursor is right after just `#`', () => {
    const content = 'hello #'
    const r = getActiveTagQuery(content, content.length)
    expect(r).toEqual({ query: '', start: 6 })
  })

  test('returns null when there is no `#` at all', () => {
    expect(getActiveTagQuery('plain text', 5)).toBeNull()
  })

  test('returns null when `#` is part of a word (e.g. foo#bar)', () => {
    // The `#` is preceded by `o` (a word char), not whitespace/punct →
    // not a tag start. Prevents false positives on URL fragments,
    // hex colors, etc.
    expect(getActiveTagQuery('foo#bar', 7)).toBeNull()
  })

  test('returns null when a space follows the `#` (tag completed)', () => {
    // Cursor is after the trailing space; getActiveTagQuery only fires
    // when the cursor sits in the tag body, not past it.
    expect(getActiveTagQuery('hello #foo bar', 14)).toBeNull()
  })

  test('handles tag at start of document', () => {
    const r = getActiveTagQuery('#wo', 3)
    expect(r).toEqual({ query: 'wo', start: 0 })
  })

  test('allows nested tags with `/`', () => {
    const content = 'hello #work/q1'
    const r = getActiveTagQuery(content, content.length)
    expect(r).toEqual({ query: 'work/q1', start: 6 })
  })

  test('punctuation before # is OK', () => {
    const r = getActiveTagQuery('(#foo', 5)
    expect(r).toEqual({ query: 'foo', start: 1 })
  })

  test('cursor in the middle of a tag returns the prefix up to cursor', () => {
    // 'hello #foobar' (# at idx 6, body at idx 7..). Cursor at idx 10
    // sits right after 'foo' → query should be 'foo'.
    const r = getActiveTagQuery('hello #foobar', 10)
    expect(r).toEqual({ query: 'foo', start: 6 })
  })

  test('returns null when cursor is at start of empty content', () => {
    expect(getActiveTagQuery('', 0)).toBeNull()
  })
})
