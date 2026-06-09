// Tests for the `noteser-properties` plugin's pure inference / filter
// / sort code. The production code is in
// `public/plugins/noteser-properties/main.js`; this test file imports
// the TypeScript mirror in `./propertiesPluginLogic.ts` so we don't
// have to bring the Worker bridge up to exercise the math.
//
// Any change to the production logic in main.js must land in the
// mirror or these tests will go stale silently. Keep the two in lock
// step.

import {
  inferValueType,
  inferColumns,
  filterNotes,
  sortNotes,
  coerceEditedValue,
  tableToMarkdown,
  compareForType,
  type NoteFixture,
} from '../propertiesPluginLogic'

const noteOf = (
  id: string,
  title: string,
  frontmatter: Record<string, unknown> | null,
  folderPath = '',
): NoteFixture => ({
  id,
  title,
  folderPath,
  body: '',
  frontmatter,
  updatedAt: 0,
})

describe('inferValueType', () => {
  it('classifies plain strings as "string"', () => {
    expect(inferValueType('draft')).toBe('string')
    expect(inferValueType('hello world')).toBe('string')
  })

  it('classifies finite numbers + numeric strings as "number"', () => {
    expect(inferValueType(42)).toBe('number')
    expect(inferValueType(-1.5)).toBe('number')
    expect(inferValueType('17')).toBe('number')
    expect(inferValueType('-3.14')).toBe('number')
  })

  it('classifies ISO date strings as "date"', () => {
    expect(inferValueType('2026-06-06')).toBe('date')
    expect(inferValueType('2026-06-06T13:45')).toBe('date')
    expect(inferValueType('2026-06-06T13:45:30.123Z')).toBe('date')
  })

  it('rejects bogus date strings', () => {
    expect(inferValueType('2026/06/06')).toBe('string')
    expect(inferValueType('not a date')).toBe('string')
  })

  it('classifies arrays of strings as "tag-array"', () => {
    expect(inferValueType(['a', 'b'])).toBe('tag-array')
    expect(inferValueType([])).toBe('tag-array')
  })

  it('classifies arrays with non-strings as "string" (heterogeneous)', () => {
    expect(inferValueType(['a', 1])).toBe('string')
  })

  it('classifies booleans as "boolean"', () => {
    expect(inferValueType(true)).toBe('boolean')
    expect(inferValueType(false)).toBe('boolean')
  })

  it('treats null / undefined / empty string as "empty"', () => {
    expect(inferValueType(null)).toBe('empty')
    expect(inferValueType(undefined)).toBe('empty')
    expect(inferValueType('')).toBe('empty')
  })

  it('treats NaN / Infinity as "string"', () => {
    expect(inferValueType(Number.NaN)).toBe('string')
    expect(inferValueType(Number.POSITIVE_INFINITY)).toBe('string')
  })
})

describe('inferColumns', () => {
  it('unions keys across every note', () => {
    const notes = [
      noteOf('1', 'A', { tags: ['x'], status: 'draft' }),
      noteOf('2', 'B', { priority: 3, due: '2026-06-06' }),
    ]
    const cols = inferColumns(notes)
    const keys = cols.map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['tags', 'status', 'priority', 'due']))
  })

  it('puts `tags` first then sorts the rest alphabetically', () => {
    const notes = [
      noteOf('1', 'A', { priority: 1, tags: ['a'], status: 'open' }),
    ]
    expect(inferColumns(notes).map((c) => c.key)).toEqual([
      'tags',
      'priority',
      'status',
    ])
  })

  it('reduces homogeneous columns to their type', () => {
    const notes = [
      noteOf('1', 'A', { priority: 3, due: '2026-06-06', tags: ['x'] }),
      noteOf('2', 'B', { priority: 1, due: '2026-06-08', tags: ['y'] }),
    ]
    const cols = inferColumns(notes)
    const map = Object.fromEntries(cols.map((c) => [c.key, c.type]))
    expect(map.priority).toBe('number')
    expect(map.due).toBe('date')
    expect(map.tags).toBe('tag-array')
  })

  it('falls back to "string" for heterogeneous columns', () => {
    const notes = [
      noteOf('1', 'A', { mixed: 'plain' }),
      noteOf('2', 'B', { mixed: 7 }),
    ]
    const cols = inferColumns(notes)
    expect(cols.find((c) => c.key === 'mixed')!.type).toBe('string')
  })

  it('drops columns that only ever held empties', () => {
    const notes = [
      noteOf('1', 'A', { blank: '', kept: 'yes' }),
      noteOf('2', 'B', { blank: null, kept: 'still' }),
    ]
    const keys = inferColumns(notes).map((c) => c.key)
    expect(keys).not.toContain('blank')
    expect(keys).toContain('kept')
  })

  it('handles notes with no frontmatter', () => {
    const notes = [
      noteOf('1', 'A', null),
      noteOf('2', 'B', { kept: 'yes' }),
    ]
    expect(inferColumns(notes).map((c) => c.key)).toEqual(['kept'])
  })
})

describe('filterNotes', () => {
  const vault = [
    noteOf('1', 'Alpha', { tags: ['rust'], status: 'draft' }, 'Projects'),
    noteOf('2', 'Beta',  { tags: ['typescript'], status: 'published', priority: 3 }, 'Projects/Web'),
    noteOf('3', 'Gamma', { tags: ['idea'], priority: 1 }, 'Inbox'),
    noteOf('4', 'Delta', null, ''),
  ]

  it('returns every note when the filter is empty or whitespace', () => {
    expect(filterNotes(vault, '').length).toBe(4)
    expect(filterNotes(vault, '   ').length).toBe(4)
  })

  it('matches a tag value', () => {
    const out = filterNotes(vault, 'rust')
    expect(out.map((n) => n.id)).toEqual(['1'])
  })

  it('matches a status value', () => {
    const out = filterNotes(vault, 'published')
    expect(out.map((n) => n.id)).toEqual(['2'])
  })

  it('matches a title', () => {
    const out = filterNotes(vault, 'Gam')
    expect(out.map((n) => n.id)).toEqual(['3'])
  })

  it('matches a folder path', () => {
    const out = filterNotes(vault, 'Projects/Web')
    expect(out.map((n) => n.id)).toEqual(['2'])
  })

  it('is case-insensitive', () => {
    expect(filterNotes(vault, 'RUST').map((n) => n.id)).toEqual(['1'])
    expect(filterNotes(vault, 'projects').map((n) => n.id).sort()).toEqual(['1', '2'])
  })

  it('matches a numeric frontmatter value coerced to string', () => {
    expect(filterNotes(vault, '3').map((n) => n.id)).toEqual(['2'])
  })

  it('returns an empty array on no match', () => {
    expect(filterNotes(vault, 'nope-no-such-thing')).toEqual([])
  })
})

describe('sortNotes', () => {
  const cols = [
    { key: 'priority', type: 'number' as const },
    { key: 'due', type: 'date' as const },
    { key: 'tags', type: 'tag-array' as const },
    { key: 'status', type: 'string' as const },
  ]

  const vault = [
    noteOf('1', 'Charlie', { priority: 3, due: '2026-06-08', tags: ['rust'],       status: 'draft' }, 'Projects'),
    noteOf('2', 'Alpha',   { priority: 1, due: '2026-06-06', tags: ['idea'],       status: 'open' },  'Inbox'),
    noteOf('3', 'Bravo',   { priority: 2, due: '2026-06-07', tags: ['typescript'], status: 'open' },  'Projects/Web'),
  ]

  it('sorts by title (asc) with the special _title key', () => {
    expect(sortNotes(vault, cols, '_title', 'asc').map((n) => n.title)).toEqual([
      'Alpha', 'Bravo', 'Charlie',
    ])
  })

  it('sorts by title (desc)', () => {
    expect(sortNotes(vault, cols, '_title', 'desc').map((n) => n.title)).toEqual([
      'Charlie', 'Bravo', 'Alpha',
    ])
  })

  it('sorts by folder path with the special _folder key', () => {
    expect(sortNotes(vault, cols, '_folder', 'asc').map((n) => n.id)).toEqual([
      '2', '1', '3', // Inbox < Projects < Projects/Web
    ])
  })

  it('sorts by a numeric column ascending', () => {
    expect(sortNotes(vault, cols, 'priority', 'asc').map((n) => n.id)).toEqual([
      '2', '3', '1',
    ])
  })

  it('sorts by a numeric column descending', () => {
    expect(sortNotes(vault, cols, 'priority', 'desc').map((n) => n.id)).toEqual([
      '1', '3', '2',
    ])
  })

  it('sorts by a date column chronologically', () => {
    expect(sortNotes(vault, cols, 'due', 'asc').map((n) => n.id)).toEqual([
      '2', '3', '1',
    ])
  })

  it('sorts by a tag-array column by joined-string', () => {
    expect(sortNotes(vault, cols, 'tags', 'asc').map((n) => n.id)).toEqual([
      '2', '1', '3', // idea < rust < typescript
    ])
  })

  it('pushes empties to the end of an ascending sort', () => {
    const sparse = [
      noteOf('a', 'A', { priority: 5 }),
      noteOf('b', 'B', null),
      noteOf('c', 'C', { priority: 2 }),
    ]
    expect(sortNotes(sparse, cols, 'priority', 'asc').map((n) => n.id)).toEqual([
      'c', 'a', 'b',
    ])
  })

  it('falls back to string sort when the column is unknown', () => {
    // Not in cols → 'string' type by default.
    const out = sortNotes(vault, cols, 'no-such-key', 'asc')
    expect(out).toHaveLength(3)
  })

  it('does not mutate the input array', () => {
    const before = vault.map((n) => n.id)
    sortNotes(vault, cols, 'priority', 'desc')
    expect(vault.map((n) => n.id)).toEqual(before)
  })
})

describe('compareForType', () => {
  it('handles NaN-coerced strings in number columns', () => {
    expect(compareForType('number', 'abc', 5)).toBe(1)  // abc → NaN → last
    expect(compareForType('number', 5, 'abc')).toBe(-1)
  })

  it('handles unparseable date strings in date columns', () => {
    expect(compareForType('date', 'nope', '2026-06-06')).toBe(1)
    expect(compareForType('date', '2026-06-06', 'nope')).toBe(-1)
  })

  it('sorts boolean strings as plain strings', () => {
    // No special boolean comparator — we sort as strings.
    expect(Math.sign(compareForType('string', 'false', 'true'))).toBe(-1)
  })
})

describe('coerceEditedValue', () => {
  it('coerces back to a number when the previous value was numeric', () => {
    expect(coerceEditedValue(3, '7')).toBe(7)
    expect(coerceEditedValue(0, '-1.5')).toBe(-1.5)
  })

  it('falls back to the raw string when the numeric coercion fails', () => {
    expect(coerceEditedValue(3, 'oops')).toBe('oops')
  })

  it('splits comma-separated strings back to arrays', () => {
    expect(coerceEditedValue(['a'], 'rust, typescript ,go')).toEqual([
      'rust', 'typescript', 'go',
    ])
  })

  it('drops empty entries from coerced arrays', () => {
    expect(coerceEditedValue(['a'], 'a,,b')).toEqual(['a', 'b'])
  })

  it('parses booleans back from their string forms', () => {
    expect(coerceEditedValue(true, 'false')).toBe(false)
    expect(coerceEditedValue(false, 'true')).toBe(true)
  })

  it('returns the raw string for plain string columns', () => {
    expect(coerceEditedValue('draft', 'published')).toBe('published')
  })
})

describe('tableToMarkdown', () => {
  it('renders a header row + a separator + one row per note', () => {
    const cols = [
      { key: 'tags', type: 'tag-array' as const },
      { key: 'status', type: 'string' as const },
    ]
    const rows = [
      noteOf('1', 'A', { tags: ['x', 'y'], status: 'draft' }, 'Projects'),
      noteOf('2', 'B', { tags: [], status: 'open' }, ''),
    ]
    const md = tableToMarkdown(cols, rows)
    expect(md).toContain('| Title | Folder | tags | status |')
    expect(md).toContain('| --- | --- | --- | --- |')
    expect(md).toContain('| A | Projects | x, y | draft |')
    expect(md).toContain('| B |  |  | open |')
  })

  it('escapes pipes in cell values', () => {
    const cols = [{ key: 'notes', type: 'string' as const }]
    const rows = [noteOf('1', 'A', { notes: 'left | right' })]
    const md = tableToMarkdown(cols, rows)
    expect(md).toContain('left \\| right')
  })
})
