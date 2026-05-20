/**
 * basesQuery.test.ts
 *
 * Verifies the Bases query DSL parser + executor. Pure functions, no
 * stores — caller passes in notes/folders.
 */

import { parseBasesQuery, executeBasesQuery } from '../utils/basesQuery'
import type { Note, Folder } from '@/types'

function n(id: string, title: string, folderId: string | null, content = ''): Note {
  return {
    id, title, content, folderId,
    createdAt: 0, updatedAt: 0,
    isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
  } as Note
}

function f(id: string, name: string, parentId: string | null = null): Folder {
  return {
    id, name, parentId,
    createdAt: 0, updatedAt: 0,
    order: 0, isDeleted: false, deletedAt: null,
  } as Folder
}

// ── parser ───────────────────────────────────────────────────────────────────

describe('parseBasesQuery', () => {
  test('empty source returns defaults', () => {
    const q = parseBasesQuery('')
    expect(q.from).toBeNull()
    expect(q.whereTags).toEqual([])
    expect(q.columns).toEqual(['title', 'tags', 'modified'])
    expect(q.sortKey).toBeNull()
    expect(q.limit).toBeNull()
  })

  test('parses from', () => {
    expect(parseBasesQuery('from Projects').from).toBe('Projects')
  })

  test('parses where tag (strips leading #)', () => {
    expect(parseBasesQuery('where tag #important').whereTags).toEqual(['important'])
    expect(parseBasesQuery('where tag work').whereTags).toEqual(['work'])
  })

  test('parses where folder', () => {
    expect(parseBasesQuery('where folder Projects/Foo').whereFolders).toEqual(['Projects/Foo'])
  })

  test('parses where property key=value (strips quotes)', () => {
    expect(parseBasesQuery('where property status="done"').whereProps)
      .toEqual([{ key: 'status', value: 'done' }])
    expect(parseBasesQuery('where property priority=high').whereProps)
      .toEqual([{ key: 'priority', value: 'high' }])
  })

  test('parses columns (comma-separated)', () => {
    expect(parseBasesQuery('columns: title, tags, due').columns).toEqual(['title', 'tags', 'due'])
  })

  test('parses sort ASC/DESC', () => {
    expect(parseBasesQuery('sort modified desc')).toMatchObject({
      sortKey: 'modified', sortDir: 'desc',
    })
    expect(parseBasesQuery('sort title')).toMatchObject({
      sortKey: 'title', sortDir: 'asc',
    })
  })

  test('parses limit', () => {
    expect(parseBasesQuery('limit 5').limit).toBe(5)
  })

  test('ignores blank + comment lines', () => {
    const q = parseBasesQuery('\n# this is a comment\nfrom X\n')
    expect(q.from).toBe('X')
  })

  test('case-insensitive keywords', () => {
    const q = parseBasesQuery('FROM X\nWHERE TAG y\nCOLUMNS title')
    expect(q.from).toBe('X')
    expect(q.whereTags).toEqual(['y'])
    expect(q.columns).toEqual(['title'])
  })
})

// ── executor ────────────────────────────────────────────────────────────────

describe('executeBasesQuery', () => {
  const projects = f('p', 'Projects')
  const subFolder = f('p2', 'Foo', 'p')
  const other = f('o', 'Other')
  const folders: Folder[] = [projects, subFolder, other]

  const notes: Note[] = [
    n('1', 'Plan trip', 'p', 'travel #important content'),
    n('2', 'Buy gifts', 'p2', 'gifts #important #urgent'),
    n('3', 'Misc', 'o', 'random'),
    n('4', 'Deleted', 'p', 'gone'),
  ]
  notes[3].isDeleted = true

  test('"from" limits to a folder + its descendants', () => {
    const rows = executeBasesQuery(parseBasesQuery('from Projects'), notes, folders)
    const ids = rows.map(r => r.noteId).sort()
    expect(ids).toEqual(['1', '2'])
  })

  test('"where tag" requires ALL listed tags', () => {
    const rows = executeBasesQuery(
      parseBasesQuery('where tag important\nwhere tag urgent'),
      notes, folders,
    )
    expect(rows.map(r => r.noteId)).toEqual(['2'])
  })

  test('drops soft-deleted notes', () => {
    const rows = executeBasesQuery(parseBasesQuery(''), notes, folders)
    const ids = rows.map(r => r.noteId).sort()
    expect(ids).toEqual(['1', '2', '3'])
  })

  test('columns include synthesized cell values', () => {
    const rows = executeBasesQuery(
      parseBasesQuery('from Projects\ncolumns: title, folder, tags'),
      notes, folders,
    )
    const planTrip = rows.find(r => r.noteId === '1')!
    expect(planTrip.cells.title).toBe('Plan trip')
    expect(planTrip.cells.folder).toBe('Projects')
    expect(planTrip.cells.tags).toBe('important')
  })

  test('sort orders rows by the chosen column', () => {
    const rows = executeBasesQuery(
      parseBasesQuery('sort title'),
      notes, folders,
    )
    expect(rows.map(r => r.title)).toEqual(['Buy gifts', 'Misc', 'Plan trip'])
  })

  test('limit caps the result count', () => {
    const rows = executeBasesQuery(parseBasesQuery('limit 1\nsort title'), notes, folders)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Buy gifts')
  })

  test('frontmatter column reads from parsed frontmatter', () => {
    const notesWithFm: Note[] = [
      n('a', 'A', null, '---\nstatus: done\n---\nbody'),
      n('b', 'B', null, '---\nstatus: todo\n---\nbody'),
    ]
    const rows = executeBasesQuery(
      parseBasesQuery('columns: title, status\nsort title'),
      notesWithFm, [],
    )
    expect(rows[0].cells.status).toBe('done')
    expect(rows[1].cells.status).toBe('todo')
  })

  test('where property filters by frontmatter equality', () => {
    const notesWithFm: Note[] = [
      n('a', 'A', null, '---\nstatus: done\n---\nbody'),
      n('b', 'B', null, '---\nstatus: todo\n---\nbody'),
    ]
    const rows = executeBasesQuery(
      parseBasesQuery('where property status=done'),
      notesWithFm, [],
    )
    expect(rows.map(r => r.noteId)).toEqual(['a'])
  })
})
