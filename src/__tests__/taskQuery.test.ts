/**
 * taskQuery.test.ts
 *
 * Unit tests for src/utils/taskQuery.ts — pure functions, no mocks needed.
 * All four exports are covered: parseTaskQuery, executeTaskQuery, groupTasks,
 * explainQuery.
 */

import {
  parseTaskQuery,
  executeTaskQuery,
  groupTasks,
  explainQuery,
  type TaskQuery,
  type ExecutedTask,
  type TaskGroup,
  type GroupBy,
} from '../utils/taskQuery'
import type { Folder } from '@/types'

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeFolder(
  id: string,
  name: string,
  parentId: string | null = null,
  isDeleted = false
): Folder {
  return {
    id,
    name,
    parentId,
    isDeleted,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    order: 0,
  }
}

/**
 * A minimal note shape that satisfies TaskSourceNote + the extra fields
 * executeTaskQuery reads via `as any` casts (folderId, title).
 */
function makeNote(
  id: string,
  title: string,
  content: string,
  folderId: string | null = null,
  isDeleted = false
) {
  return { id, title, content, folderId, isDeleted }
}

// ── parseTaskQuery ────────────────────────────────────────────────────────────

describe('parseTaskQuery', () => {
  test('empty source returns empty query', () => {
    expect(parseTaskQuery('')).toEqual<TaskQuery>({
      filters: [],
      groupBy: [],
      explain: false,
      source: '',
    })
  })

  test('"not done" → one notDone filter', () => {
    const q = parseTaskQuery('not done')
    expect(q.filters).toEqual([{ kind: 'notDone' }])
    expect(q.groupBy).toEqual([])
    expect(q.explain).toBe(false)
  })

  test('"done" alone → one done filter', () => {
    const q = parseTaskQuery('done')
    expect(q.filters).toEqual([{ kind: 'done' }])
  })

  test('"done today" → one doneToday filter (not separate done + today)', () => {
    const q = parseTaskQuery('done today')
    expect(q.filters).toHaveLength(1)
    expect(q.filters[0]).toEqual({ kind: 'doneToday' })
  })

  test('"DONE TODAY" (case-insensitive) → doneToday filter', () => {
    const q = parseTaskQuery('DONE TODAY')
    expect(q.filters).toHaveLength(1)
    expect(q.filters[0]).toEqual({ kind: 'doneToday' })
  })

  test('"path includes Projects" → one pathIncludes filter', () => {
    const q = parseTaskQuery('path includes Projects')
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Projects' }])
  })

  test('"path includes Projects group by folder" → substring is only "Projects"', () => {
    const q = parseTaskQuery('path includes Projects group by folder')
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Projects' }])
    expect(q.groupBy).toEqual(['folder'])
  })

  test('"path includes Some Multi Word group by folder" → multi-word substring captured correctly', () => {
    const q = parseTaskQuery('path includes Some Multi Word group by folder')
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Some Multi Word' }])
    expect(q.groupBy).toEqual(['folder'])
  })

  test('"path includes" with no substring before EOF → no filter added', () => {
    const q = parseTaskQuery('path includes')
    expect(q.filters).toHaveLength(0)
  })

  test('"group by folder" → groupBy: ["folder"]', () => {
    const q = parseTaskQuery('group by folder')
    expect(q.groupBy).toEqual(['folder'])
    expect(q.filters).toEqual([])
  })

  test('"group by filename" → groupBy: ["filename"]', () => {
    const q = parseTaskQuery('group by filename')
    expect(q.groupBy).toEqual(['filename'])
  })

  test('"group by folder group by filename" → groupBy: ["folder", "filename"] in order', () => {
    const q = parseTaskQuery('group by folder group by filename')
    expect(q.groupBy).toEqual(['folder', 'filename'])
  })

  test('"group by bogus" → ignored, no groupBy added', () => {
    const q = parseTaskQuery('group by bogus')
    expect(q.groupBy).toEqual([])
  })

  test('"explain" → explain: true', () => {
    const q = parseTaskQuery('explain')
    expect(q.explain).toBe(true)
    expect(q.filters).toEqual([])
    expect(q.groupBy).toEqual([])
  })

  test('real-world compound query parses all clauses correctly', () => {
    const src = 'done today path includes Projects group by folder group by filename explain'
    const q = parseTaskQuery(src)
    expect(q.filters).toHaveLength(2)
    expect(q.filters[0]).toEqual({ kind: 'doneToday' })
    expect(q.filters[1]).toEqual({ kind: 'pathIncludes', substring: 'Projects' })
    expect(q.groupBy).toEqual(['folder', 'filename'])
    expect(q.explain).toBe(true)
    expect(q.source).toBe(src)
  })

  test('multi-line input is identical to space-separated', () => {
    const multiLine = parseTaskQuery('not done\npath includes Projects\ngroup by folder')
    const spaceSep = parseTaskQuery('not done path includes Projects group by folder')
    expect(multiLine.filters).toEqual(spaceSep.filters)
    expect(multiLine.groupBy).toEqual(spaceSep.groupBy)
  })

  test('unknown tokens are silently skipped', () => {
    const q = parseTaskQuery('foobar xyzzy not done')
    expect(q.filters).toEqual([{ kind: 'notDone' }])
  })

  test('source field is preserved verbatim', () => {
    const src = '  done  today  '
    const q = parseTaskQuery(src)
    expect(q.source).toBe(src)
  })

  test('"path includes" followed immediately by a clause keyword → no filter added', () => {
    // "path includes not done" — "not" is a CLAUSE_KEYWORD so substring is empty
    const q = parseTaskQuery('path includes not done')
    expect(q.filters).toEqual([{ kind: 'notDone' }])
    // The pathIncludes filter should NOT be pushed because parts.length === 0
    expect(q.filters.every(f => f.kind !== 'pathIncludes')).toBe(true)
  })
})

// ── executeTaskQuery ──────────────────────────────────────────────────────────

describe('executeTaskQuery', () => {
  const emptyQuery = parseTaskQuery('')

  test('no notes → returns empty array', () => {
    const result = executeTaskQuery(emptyQuery, { notes: [], folders: [] })
    expect(result).toEqual([])
  })

  test('deleted notes are excluded', () => {
    const notes = [
      makeNote('a', 'Active', '- [ ] task A'),
      makeNote('b', 'Deleted', '- [ ] task B', null, true),
    ]
    const result = executeTaskQuery(emptyQuery, { notes, folders: [] })
    expect(result).toHaveLength(1)
    expect(result[0].noteId).toBe('a')
  })

  test('root-level note: path === noteTitle, folderPath === ""', () => {
    const notes = [makeNote('n1', 'My Note', '- [ ] foo')]
    const result = executeTaskQuery(emptyQuery, { notes, folders: [] })
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('My Note')
    expect(result[0].noteTitle).toBe('My Note')
    expect(result[0].folderPath).toBe('')
  })

  test('note inside a single folder has correct path and folderPath', () => {
    const folders = [makeFolder('f1', 'Projects')]
    const notes = [makeNote('n1', 'Plan', '- [ ] foo', 'f1')]
    const result = executeTaskQuery(emptyQuery, { notes, folders })
    expect(result).toHaveLength(1)
    expect(result[0].folderPath).toBe('Projects')
    expect(result[0].path).toBe('Projects/Plan')
    expect(result[0].noteTitle).toBe('Plan')
  })

  test('note inside a nested folder chain produces correct path', () => {
    // Inbox → Daily (parent=Inbox)
    const folders = [
      makeFolder('root', 'Root'),
      makeFolder('inbox', 'Inbox', 'root'),
      makeFolder('daily', 'Daily', 'inbox'),
    ]
    const notes = [makeNote('n1', 'Entry', '- [ ] nested task', 'daily')]
    const result = executeTaskQuery(emptyQuery, { notes, folders })
    expect(result).toHaveLength(1)
    // Root is included only because buildFolderPath walks up until parentId is null
    expect(result[0].folderPath).toBe('Root/Inbox/Daily')
    expect(result[0].path).toBe('Root/Inbox/Daily/Entry')
  })

  test('deleted folder in parent chain is excluded from folderById → path stops early', () => {
    // inbox is deleted — buildFolderPath skips it because it is not in folderById
    const folders = [
      makeFolder('inbox', 'Inbox', null, true), // deleted
      makeFolder('daily', 'Daily', 'inbox'),
    ]
    const notes = [makeNote('n1', 'Entry', '- [ ] task', 'daily')]
    const result = executeTaskQuery(emptyQuery, { notes, folders })
    expect(result).toHaveLength(1)
    // 'daily' folder is present but its parent 'inbox' was deleted and won't be in
    // folderById, so the walk stops after 'Daily'
    expect(result[0].folderPath).toBe('Daily')
    expect(result[0].path).toBe('Daily/Entry')
  })

  test('cycle in parentId does not infinite-loop (depth cap at 64)', () => {
    // f1 → f2 → f1 (cycle)
    const folders: Folder[] = [
      { ...makeFolder('f1', 'A', 'f2') },
      { ...makeFolder('f2', 'B', 'f1') },
    ]
    const notes = [makeNote('n1', 'Cyclic Note', '- [ ] task', 'f1')]
    // Should complete without hanging and produce a finite folderPath
    expect(() => {
      const result = executeTaskQuery(emptyQuery, { notes, folders })
      expect(result).toHaveLength(1)
      // The path is finite; we don't pin the exact string since it depends on
      // which direction the walk hits the depth cap
      expect(typeof result[0].folderPath).toBe('string')
    }).not.toThrow()
  })

  test('notDone filter excludes completed tasks', () => {
    const notes = [
      makeNote('n1', 'Note', '- [ ] open\n- [x] done one ✅ 2026-05-18'),
    ]
    const q = parseTaskQuery('not done')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result).toHaveLength(1)
    expect(result[0].completed).toBe(false)
    expect(result[0].text).toBe('open')
  })

  test('done filter excludes incomplete tasks', () => {
    const notes = [
      makeNote('n1', 'Note', '- [ ] open\n- [x] finished'),
    ]
    const q = parseTaskQuery('done')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result).toHaveLength(1)
    expect(result[0].completed).toBe(true)
    expect(result[0].text).toBe('finished')
  })

  test('doneToday filter: only tasks with completedDate === today', () => {
    const notes = [
      makeNote(
        'n1',
        'Note',
        '- [x] today task ✅ 2026-05-18\n- [x] yesterday task ✅ 2026-05-17\n- [ ] open task'
      ),
    ]
    const q = parseTaskQuery('done today')
    const result = executeTaskQuery(q, {
      notes,
      folders: [],
      today: '2026-05-18',
    })
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('today task')
    expect(result[0].completedDate).toBe('2026-05-18')
  })

  test('doneToday filter: task with wrong date is excluded', () => {
    const notes = [
      makeNote('n1', 'Note', '- [x] old task ✅ 2026-05-17'),
    ]
    const q = parseTaskQuery('done today')
    const result = executeTaskQuery(q, {
      notes,
      folders: [],
      today: '2026-05-18',
    })
    expect(result).toHaveLength(0)
  })

  test('pathIncludes filter is case-insensitive (folder name)', () => {
    const folders = [makeFolder('f1', 'Projects')]
    const notes = [makeNote('n1', 'Plan', '- [ ] task', 'f1')]
    const q = parseTaskQuery('path includes projects')
    const result = executeTaskQuery(q, { notes, folders })
    expect(result).toHaveLength(1)
  })

  test('pathIncludes filter is case-insensitive (note title)', () => {
    const folders = [makeFolder('f1', 'Projects')]
    const notes = [makeNote('n1', 'Plan', '- [ ] task', 'f1')]
    const q = parseTaskQuery('path includes PLAN')
    const result = executeTaskQuery(q, { notes, folders })
    expect(result).toHaveLength(1)
  })

  test('pathIncludes filter excludes non-matching paths', () => {
    const folders = [makeFolder('f1', 'Archive')]
    const notes = [makeNote('n1', 'OldNote', '- [ ] task', 'f1')]
    const q = parseTaskQuery('path includes Projects')
    const result = executeTaskQuery(q, { notes, folders })
    expect(result).toHaveLength(0)
  })

  test('multiple filters are ANDed: notDone + pathIncludes', () => {
    const folders = [
      makeFolder('f1', 'Projects'),
      makeFolder('f2', 'Archive'),
    ]
    const notes = [
      makeNote('n1', 'Active', '- [ ] open in projects\n- [x] done in projects ✅ 2026-05-18', 'f1'),
      makeNote('n2', 'OldNote', '- [ ] open in archive', 'f2'),
    ]
    const q = parseTaskQuery('not done path includes Projects')
    const result = executeTaskQuery(q, { notes, folders })
    // Only the open task from the 'Projects' folder should be returned
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('open in projects')
    expect(result[0].folderPath).toBe('Projects')
    expect(result[0].completed).toBe(false)
  })

  test('note with undefined/empty content produces no tasks', () => {
    const notes = [
      makeNote('n1', 'Empty', ''),
    ]
    const result = executeTaskQuery(emptyQuery, { notes, folders: [] })
    expect(result).toHaveLength(0)
  })

  test('note title defaults to "Untitled" when title is empty string', () => {
    const notes = [makeNote('n1', '', '- [ ] task')]
    const result = executeTaskQuery(emptyQuery, { notes, folders: [] })
    expect(result).toHaveLength(1)
    expect(result[0].noteTitle).toBe('Untitled')
    expect(result[0].path).toBe('Untitled')
  })

  test('executed tasks include all Task fields', () => {
    const notes = [makeNote('n1', 'Note', '- [x] done ✅ 2026-05-18')]
    const result = executeTaskQuery(emptyQuery, { notes, folders: [] })
    expect(result[0]).toMatchObject({
      noteId: 'n1',
      lineNumber: 0,
      text: 'done',
      completed: true,
      completedDate: '2026-05-18',
      path: 'Note',
      noteTitle: 'Note',
      folderPath: '',
    })
  })
})

// ── groupTasks ────────────────────────────────────────────────────────────────

describe('groupTasks', () => {
  /** Build a minimal ExecutedTask for grouping tests. */
  function makeTask(
    text: string,
    noteTitle: string,
    folderPath: string
  ): ExecutedTask {
    const path = folderPath ? `${folderPath}/${noteTitle}` : noteTitle
    return {
      noteId: 'x',
      lineNumber: 0,
      text,
      completed: false,
      completedDate: null,
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      priority: 'normal',
      path,
      noteTitle,
      folderPath,
    }
  }

  const tasks: ExecutedTask[] = [
    makeTask('alpha', 'Plan', 'Projects'),
    makeTask('beta', 'Plan', 'Projects'),
    makeTask('gamma', 'Journal', 'Personal'),
    makeTask('delta', 'Inbox', ''),         // root-level note
  ]

  test('empty groupBy → single group with keys: [] containing all tasks', () => {
    const groups = groupTasks(tasks, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].keys).toEqual([])
    expect(groups[0].tasks).toHaveLength(4)
  })

  test('groupBy ["folder"] → groups by folderPath, root becomes "Root"', () => {
    const groups = groupTasks(tasks, ['folder'])
    expect(groups).toHaveLength(3)
    const keys = groups.map(g => g.keys[0])
    expect(keys).toContain('Projects')
    expect(keys).toContain('Personal')
    expect(keys).toContain('Root')

    const projectsGroup = groups.find(g => g.keys[0] === 'Projects')!
    expect(projectsGroup.tasks).toHaveLength(2)

    const rootGroup = groups.find(g => g.keys[0] === 'Root')!
    expect(rootGroup.tasks).toHaveLength(1)
    expect(rootGroup.tasks[0].text).toBe('delta')
  })

  test('groupBy ["filename"] → groups by noteTitle', () => {
    const groups = groupTasks(tasks, ['filename'])
    expect(groups).toHaveLength(3)
    const keys = groups.map(g => g.keys[0])
    expect(keys).toContain('Plan')
    expect(keys).toContain('Journal')
    expect(keys).toContain('Inbox')

    const planGroup = groups.find(g => g.keys[0] === 'Plan')!
    expect(planGroup.tasks).toHaveLength(2)
  })

  test('groupBy ["folder", "filename"] → keys have two entries', () => {
    const groups = groupTasks(tasks, ['folder', 'filename'])
    // Projects/Plan (2 tasks), Personal/Journal (1), Root/Inbox (1)
    expect(groups).toHaveLength(3)
    const projectsPlanGroup = groups.find(
      g => g.keys[0] === 'Projects' && g.keys[1] === 'Plan'
    )!
    expect(projectsPlanGroup).toBeDefined()
    expect(projectsPlanGroup.tasks).toHaveLength(2)
  })

  test('groups are sorted by key sequence (localeCompare)', () => {
    const groups = groupTasks(tasks, ['folder'])
    const keys = groups.map(g => g.keys[0])
    const sorted = [...keys].sort((a, b) => a.localeCompare(b))
    expect(keys).toEqual(sorted)
  })

  test('empty task array → single group with empty tasks list', () => {
    const groups = groupTasks([], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].tasks).toHaveLength(0)
  })

  test('empty task array with groupBy → returns empty groups array', () => {
    const groups = groupTasks([], ['folder'])
    expect(groups).toHaveLength(0)
  })
})

// ── explainQuery ──────────────────────────────────────────────────────────────

describe('explainQuery', () => {
  test('empty query → "(empty query)"', () => {
    expect(explainQuery(parseTaskQuery(''))).toBe('(empty query)')
  })

  test('"not done" query → contains "not done"', () => {
    expect(explainQuery(parseTaskQuery('not done'))).toContain('not done')
  })

  test('"done" query → contains "done"', () => {
    const result = explainQuery(parseTaskQuery('done'))
    expect(result).toContain('done')
  })

  test('"done today" query → contains "done today"', () => {
    expect(explainQuery(parseTaskQuery('done today'))).toContain('done today')
  })

  test('"path includes Projects" → contains path includes "Projects"', () => {
    const result = explainQuery(parseTaskQuery('path includes Projects'))
    expect(result).toContain('path includes "Projects"')
  })

  test('groupBy folder → contains "group by folder"', () => {
    expect(explainQuery(parseTaskQuery('group by folder'))).toContain('group by folder')
  })

  test('groupBy filename → contains "group by filename"', () => {
    expect(explainQuery(parseTaskQuery('group by filename'))).toContain('group by filename')
  })

  test('full compound query explains all clauses', () => {
    const q = parseTaskQuery(
      'done today path includes Projects group by folder group by filename explain'
    )
    const explanation = explainQuery(q)
    expect(explanation).toContain('done today')
    expect(explanation).toContain('path includes "Projects"')
    expect(explanation).toContain('group by folder')
    expect(explanation).toContain('group by filename')
  })

  test('multi-group explain lists both groups', () => {
    const q = parseTaskQuery('group by folder group by filename')
    const result = explainQuery(q)
    expect(result).toContain('group by folder')
    expect(result).toContain('group by filename')
  })
})
