/**
 * frontmatter.test.ts
 *
 * Verifies the subset-YAML parser + serializer. We don't aim for full
 * YAML coverage — just round-trip on the shapes Obsidian's properties UI
 * emits (inline arrays, scalars, booleans, numbers).
 */

import {
  parseFrontmatter,
  writeFrontmatter,
  serializeFrontmatterFields,
  type FrontmatterField,
} from '../utils/frontmatter'

describe('parseFrontmatter', () => {
  test('returns hasFrontmatter=false when content has no fences', () => {
    const p = parseFrontmatter('just a body')
    expect(p.hasFrontmatter).toBe(false)
    expect(p.body).toBe('just a body')
    expect(p.fields).toEqual([])
  })

  test('parses a single string field', () => {
    const p = parseFrontmatter('---\ntitle: Hello\n---\nbody text')
    expect(p.hasFrontmatter).toBe(true)
    expect(p.body).toBe('body text')
    expect(p.fields).toHaveLength(1)
    expect(p.fields[0]).toMatchObject({ key: 'title', value: 'Hello', isArray: false })
  })

  test('parses quoted strings', () => {
    const p = parseFrontmatter('---\ntitle: "Hello: world"\n---\n')
    expect(p.fields[0].value).toBe('Hello: world')
  })

  test('parses inline array fields', () => {
    const p = parseFrontmatter('---\ntags: [foo, "ba r", baz]\n---\n')
    expect(p.fields[0].value).toEqual(['foo', 'ba r', 'baz'])
    expect(p.fields[0].isArray).toBe(true)
  })

  test('parses empty inline arrays', () => {
    const p = parseFrontmatter('---\ntags: []\n---\n')
    expect(p.fields[0].value).toEqual([])
  })

  test('parses booleans + numbers', () => {
    const p = parseFrontmatter('---\ndraft: true\npriority: 3\nratio: 1.5\n---\n')
    expect(p.fields[0].value).toBe(true)
    expect(p.fields[1].value).toBe(3)
    expect(p.fields[2].value).toBe(1.5)
  })

  test('handles fences with no body after', () => {
    const p = parseFrontmatter('---\nkey: value\n---')
    expect(p.hasFrontmatter).toBe(true)
    expect(p.body).toBe('')
  })

  test('marks unparseable lines as isUnknown but preserves them', () => {
    const p = parseFrontmatter('---\nweird-line-without-colon\n---\n')
    expect(p.fields[0].isUnknown).toBe(true)
    expect(p.fields[0].raw).toBe('weird-line-without-colon')
  })

  test('CRLF line endings work', () => {
    const p = parseFrontmatter('---\r\ntitle: x\r\n---\r\nbody')
    expect(p.hasFrontmatter).toBe(true)
    expect(p.fields[0].key).toBe('title')
  })
})

describe('serializeFrontmatterFields', () => {
  test('round-trips scalar + array + boolean fields', () => {
    const fields: FrontmatterField[] = [
      { key: 'title',  value: 'Hello', isArray: false, raw: '', isUnknown: false },
      { key: 'tags',   value: ['a', 'b c'], isArray: true, raw: '', isUnknown: false },
      { key: 'draft',  value: true,    isArray: false, raw: '', isUnknown: false },
      { key: 'rating', value: 3,       isArray: false, raw: '', isUnknown: false },
    ]
    const out = serializeFrontmatterFields(fields)
    expect(out).toContain('title: Hello')
    expect(out).toContain('tags: [a, "b c"]')
    expect(out).toContain('draft: true')
    expect(out).toContain('rating: 3')
  })

  test('preserves unparseable lines verbatim via the raw field', () => {
    const out = serializeFrontmatterFields([
      { key: '', value: null, isArray: false, raw: 'weird-line-without-colon', isUnknown: true },
    ])
    expect(out).toBe('weird-line-without-colon')
  })

  test('quotes scalars that would break the parser', () => {
    const out = serializeFrontmatterFields([
      { key: 'title', value: 'has: colon', isArray: false, raw: '', isUnknown: false },
    ])
    expect(out).toBe('title: "has: colon"')
  })
})

describe('writeFrontmatter', () => {
  test('prepends a frontmatter block to a body that had none', () => {
    const content = 'just a body\n'
    const next = writeFrontmatter(content, [
      { key: 'tags', value: ['a'], isArray: true, raw: '', isUnknown: false },
    ])
    expect(next).toBe('---\ntags: [a]\n---\njust a body\n')
  })

  test('replaces an existing frontmatter block without touching the body', () => {
    const content = '---\ntitle: old\n---\nbody'
    const next = writeFrontmatter(content, [
      { key: 'title', value: 'new', isArray: false, raw: '', isUnknown: false },
    ])
    expect(next).toBe('---\ntitle: new\n---\nbody')
  })

  test('passing an empty fields array strips the frontmatter block', () => {
    const content = '---\nkey: value\n---\nbody'
    expect(writeFrontmatter(content, [])).toBe('body')
  })

  test('passing an empty fields array on no-frontmatter content is a no-op', () => {
    expect(writeFrontmatter('plain', [])).toBe('plain')
  })
})
