/**
 * helpSections.test.ts
 *
 * Unit-tests parseHelpBody, the markdown splitter that feeds the /help
 * page's per-section disclosure groups. Guarantees:
 *   - the H1 + lead paragraph land in `intro`
 *   - each H2 becomes a section with a slug and a body
 *   - fenced code blocks containing ## are not treated as headings
 *   - duplicate headings get collision-free slugs (foo, foo-1, foo-2)
 */

import { parseHelpBody } from '../help/sections'

describe('parseHelpBody', () => {
  test('separates intro from H2 sections', () => {
    const body = [
      '# Title',
      '',
      'Lead paragraph.',
      '',
      '## First',
      '',
      'First body.',
      '',
      '## Second',
      '',
      'Second body.',
    ].join('\n')

    const { intro, sections } = parseHelpBody(body)
    expect(intro).toContain('# Title')
    expect(intro).toContain('Lead paragraph.')
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ heading: 'First', slug: 'first' })
    expect(sections[0].body).toBe('First body.')
    expect(sections[1]).toMatchObject({ heading: 'Second', slug: 'second' })
    expect(sections[1].body).toBe('Second body.')
  })

  test('ignores ## inside fenced code blocks', () => {
    const body = [
      '# Title',
      '',
      '## Real',
      '',
      '```',
      '## not a heading',
      '```',
      '',
      'After.',
    ].join('\n')

    const { sections } = parseHelpBody(body)
    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe('Real')
    expect(sections[0].body).toContain('## not a heading')
    expect(sections[0].body).toContain('After.')
  })

  test('suffixes collision-free slugs for duplicate headings', () => {
    const body = [
      '# Title',
      '',
      '## Section',
      'a',
      '',
      '## Section',
      'b',
    ].join('\n')

    const { sections } = parseHelpBody(body)
    expect(sections.map(s => s.slug)).toEqual(['section', 'section-1'])
  })

  test('strips backticks from heading text but keeps the body intact', () => {
    const body = [
      '# Title',
      '',
      '## Tag autocomplete on `#`',
      '',
      'Type a `#` somewhere.',
    ].join('\n')

    const { sections } = parseHelpBody(body)
    expect(sections[0].heading).toBe('Tag autocomplete on #')
    expect(sections[0].slug).toBe('tag-autocomplete-on')
    expect(sections[0].body).toContain('Type a `#` somewhere.')
  })

  test('returns an empty sections array for a heading-free body', () => {
    const body = '# Title\n\nJust prose.'
    const { intro, sections } = parseHelpBody(body)
    expect(sections).toEqual([])
    expect(intro).toContain('Just prose.')
  })
})
