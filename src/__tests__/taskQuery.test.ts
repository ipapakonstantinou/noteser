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

  test('"path includes \\"Projects\\"" → quotes stripped, substring is bare Projects', () => {
    // Regression: Obsidian-Tasks quoting. The literal quote chars must NOT
    // survive into the substring or no path will ever match.
    const q = parseTaskQuery('path includes "Projects"')
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Projects' }])
  })

  test("\"path includes 'Projects'\" (single quotes) → quotes stripped", () => {
    const q = parseTaskQuery("path includes 'Projects'")
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Projects' }])
  })

  test('"path includes \\"Some Multi Word\\"" → quotes stripped, multi-word kept', () => {
    const q = parseTaskQuery('path includes "Some Multi Word" group by folder')
    expect(q.filters).toEqual([{ kind: 'pathIncludes', substring: 'Some Multi Word' }])
    expect(q.groupBy).toEqual(['folder'])
  })

  test('unbalanced/inner quotes are left intact', () => {
    // Only a matching leading+trailing pair is stripped.
    expect(parseTaskQuery('path includes "Projects').filters).toEqual([
      { kind: 'pathIncludes', substring: '"Projects' },
    ])
    expect(parseTaskQuery('path includes Foo"Bar"').filters).toEqual([
      { kind: 'pathIncludes', substring: 'Foo"Bar"' },
    ])
  })

  test('empty quoted substring "" → no filter added', () => {
    const q = parseTaskQuery('path includes ""')
    expect(q.filters.every(f => f.kind !== 'pathIncludes')).toBe(true)
  })

  test('multi-line query with quoted path matches the parser of the unquoted form', () => {
    const q = parseTaskQuery('done today\npath includes "Projects"\ngroup by folder\ngroup by filename')
    expect(q.filters).toEqual([
      { kind: 'doneToday' },
      { kind: 'pathIncludes', substring: 'Projects' },
    ])
    expect(q.groupBy).toEqual(['folder', 'filename'])
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

// ── executeTaskQuery — "done today" + quoted path (real-world bug) ─────────────

describe('executeTaskQuery — done today with quoted path filter', () => {
  const TODAY = '2026-05-26'

  // The exact line from the bug report: wikilink, stray bracket, a URL in
  // parens, and the ✅ completion stamp at the end. Verifies metadata
  // extraction survives the surrounding punctuation.
  const REAL_LINE =
    '- [x] Move to BG ETEM in all systems [[C02130-483]] IIA Book: Additional Columns - Jira@consolut] (https://consolut.atlassian.net/browse/C02130-483) ✅ 2026-05-26'

  function projectsNote(content: string) {
    const folders = [makeFolder('f-proj', 'Projects')]
    const notes = [makeNote('n1', 'C02130-483', content, 'f-proj')]
    return { notes, folders }
  }

  test('real-world line: `done today` + `path includes "Projects"` matches the completed task', () => {
    const { notes, folders } = projectsNote(REAL_LINE)
    const q = parseTaskQuery(
      'done today\npath includes "Projects"\ngroup by folder\ngroup by filename'
    )
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result).toHaveLength(1)
    expect(result[0].completed).toBe(true)
    expect(result[0].completedDate).toBe(TODAY)
    expect(result[0].folderPath).toBe('Projects')
    expect(result[0].text).toContain('Move to BG ETEM in all systems')
  })

  test('`done today` matches a task whose ✅ date is today', () => {
    const { notes, folders } = projectsNote('- [x] shipped it ✅ 2026-05-26')
    const q = parseTaskQuery('done today path includes "Projects"')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result.map(r => r.text)).toEqual(['shipped it'])
  })

  test('`done today` does NOT match a task completed yesterday', () => {
    const { notes, folders } = projectsNote('- [x] shipped yesterday ✅ 2026-05-25')
    const q = parseTaskQuery('done today path includes "Projects"')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result).toHaveLength(0)
  })

  test('`done today` does NOT match a completed task with no ✅ date', () => {
    const { notes, folders } = projectsNote('- [x] done but undated')
    const q = parseTaskQuery('done today')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result).toHaveLength(0)
  })

  test('plain `done` still matches a completed task with no date', () => {
    const { notes, folders } = projectsNote('- [x] done but undated')
    const q = parseTaskQuery('done')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result.map(r => r.text)).toEqual(['done but undated'])
  })

  test('quoted `path includes` excludes a note that is NOT under Projects', () => {
    const folders = [makeFolder('f-arch', 'Archive')]
    const notes = [makeNote('n1', 'Old', '- [x] done elsewhere ✅ 2026-05-26', 'f-arch')]
    const q = parseTaskQuery('done today path includes "Projects"')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result).toHaveLength(0)
  })

  test('`done before`/`done after` still behave (regression guard)', () => {
    // These tokens are not first-class filters; verify the parser does not
    // explode and `done` is still applied. `before`/`after` are skipped.
    const { notes, folders } = projectsNote(
      '- [x] a ✅ 2026-05-20\n- [x] b ✅ 2026-05-26\n- [ ] open'
    )
    const qBefore = parseTaskQuery('done before 2026-05-22')
    const qAfter = parseTaskQuery('done after 2026-05-22')
    // `done` matches both completed tasks; the date words are ignored.
    expect(
      executeTaskQuery(qBefore, { notes, folders, today: TODAY }).map(r => r.text).sort()
    ).toEqual(['a', 'b'])
    expect(
      executeTaskQuery(qAfter, { notes, folders, today: TODAY }).map(r => r.text).sort()
    ).toEqual(['a', 'b'])
  })

  test('`not done` still excludes the completed task', () => {
    const { notes, folders } = projectsNote('- [x] done ✅ 2026-05-26\n- [ ] open')
    const q = parseTaskQuery('not done path includes "Projects"')
    const result = executeTaskQuery(q, { notes, folders, today: TODAY })
    expect(result.map(r => r.text)).toEqual(['open'])
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
      recurrence: null,
      path,
      noteTitle,
      folderPath,
      noteCreatedAt: 0,
      tags: [],
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

// ── New v5h7-era surface: date / priority filters, sort, group by tag/priority ─

describe('parseTaskQuery — new filters', () => {
  test('"due before 2026-05-20" → dueBefore filter', () => {
    const q = parseTaskQuery('due before 2026-05-20')
    expect(q.filters).toEqual([{ kind: 'dueBefore', date: '2026-05-20' }])
  })

  test('"due after 2026-05-20" → dueAfter filter', () => {
    const q = parseTaskQuery('due after 2026-05-20')
    expect(q.filters).toEqual([{ kind: 'dueAfter', date: '2026-05-20' }])
  })

  test('"due on 2026-05-20" → dueOn filter', () => {
    const q = parseTaskQuery('due on 2026-05-20')
    expect(q.filters).toEqual([{ kind: 'dueOn', date: '2026-05-20' }])
  })

  test('"due" alone → hasDue filter', () => {
    const q = parseTaskQuery('due')
    expect(q.filters).toEqual([{ kind: 'hasDue' }])
  })

  test('"no due date" → noDue filter', () => {
    const q = parseTaskQuery('no due date')
    expect(q.filters).toEqual([{ kind: 'noDue' }])
  })

  test('"scheduled before 2026-05-20" → scheduledBefore filter', () => {
    const q = parseTaskQuery('scheduled before 2026-05-20')
    expect(q.filters).toEqual([{ kind: 'scheduledBefore', date: '2026-05-20' }])
  })

  test('"no scheduled date" → noScheduled filter', () => {
    const q = parseTaskQuery('no scheduled date')
    expect(q.filters).toEqual([{ kind: 'noScheduled' }])
  })

  test('"priority is highest" → priorityIs highest', () => {
    const q = parseTaskQuery('priority is highest')
    expect(q.filters).toEqual([{ kind: 'priorityIs', priority: 'highest' }])
  })

  test('"priority above normal" → priorityAbove normal', () => {
    const q = parseTaskQuery('priority above normal')
    expect(q.filters).toEqual([{ kind: 'priorityAbove', priority: 'normal' }])
  })

  test('"priority below high" → priorityBelow high', () => {
    const q = parseTaskQuery('priority below high')
    expect(q.filters).toEqual([{ kind: 'priorityBelow', priority: 'high' }])
  })

  test('"priority is bogus" is silently skipped (no filter)', () => {
    const q = parseTaskQuery('priority is bogus')
    expect(q.filters).toEqual([])
  })

  test('malformed date "due before 2026-13-99" is treated as plain due (hasDue)', () => {
    const q = parseTaskQuery('due before notadate')
    // "due" matches as hasDue; "before notadate" is then skipped token-by-token
    expect(q.filters).toEqual([{ kind: 'hasDue' }])
  })

  test('"sort by due" → sortBy: "due"', () => {
    const q = parseTaskQuery('sort by due')
    expect(q.sortBy).toBe('due')
  })

  test('"sort by priority" → sortBy: "priority"', () => {
    const q = parseTaskQuery('sort by priority')
    expect(q.sortBy).toBe('priority')
  })

  test('"sort by created" → sortBy: "created"', () => {
    const q = parseTaskQuery('sort by created')
    expect(q.sortBy).toBe('created')
  })

  test('"sort by bogus" is ignored, sortBy stays undefined', () => {
    const q = parseTaskQuery('sort by bogus')
    expect(q.sortBy).toBeUndefined()
  })

  test('later sort-by clauses overwrite earlier ones', () => {
    const q = parseTaskQuery('sort by due sort by priority')
    expect(q.sortBy).toBe('priority')
  })

  test('"group by tag" → groupBy: ["tag"]', () => {
    const q = parseTaskQuery('group by tag')
    expect(q.groupBy).toEqual(['tag'])
  })

  test('"group by priority" → groupBy: ["priority"]', () => {
    const q = parseTaskQuery('group by priority')
    expect(q.groupBy).toEqual(['priority'])
  })

  test('compound query with all new clauses parses everything', () => {
    const q = parseTaskQuery(
      'priority above normal due before 2026-05-25 sort by due group by priority'
    )
    expect(q.filters).toContainEqual({ kind: 'priorityAbove', priority: 'normal' })
    expect(q.filters).toContainEqual({ kind: 'dueBefore', date: '2026-05-25' })
    expect(q.sortBy).toBe('due')
    expect(q.groupBy).toEqual(['priority'])
  })
})

describe('executeTaskQuery — new filters', () => {
  function makeNote(
    id: string,
    title: string,
    content: string,
    folderId: string | null = null,
    createdAt = 0,
    isDeleted = false
  ) {
    return { id, title, content, folderId, createdAt, isDeleted }
  }

  test('"due before 2026-05-20" returns only tasks with due < that date', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] before 📅 2026-05-19',
        '- [ ] exact  📅 2026-05-20',
        '- [ ] after  📅 2026-05-21',
        '- [ ] no due',
      ].join('\n')),
    ]
    const q = parseTaskQuery('due before 2026-05-20')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['before'])
  })

  test('"due on 2026-05-20" returns only exact-match', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] before 📅 2026-05-19',
        '- [ ] exact  📅 2026-05-20',
        '- [ ] after  📅 2026-05-21',
      ].join('\n')),
    ]
    const q = parseTaskQuery('due on 2026-05-20')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['exact'])
  })

  test('"no due date" returns only tasks without a due date', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] has due 📅 2026-05-20',
        '- [ ] no due',
      ].join('\n')),
    ]
    const q = parseTaskQuery('no due date')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['no due'])
  })

  test('"priority above normal" returns only highest and high', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] highest ⏫',
        '- [ ] high 🔼',
        '- [ ] normal',
        '- [ ] low 🔽',
        '- [ ] lowest ⏬',
      ].join('\n')),
    ]
    const q = parseTaskQuery('priority above normal')
    const result = executeTaskQuery(q, { notes, folders: [] })
    const texts = result.map(r => r.text).sort()
    expect(texts).toEqual(['high', 'highest'])
  })

  test('"priority is high" returns only the high task', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] highest ⏫',
        '- [ ] high 🔼',
        '- [ ] normal',
      ].join('\n')),
    ]
    const q = parseTaskQuery('priority is high')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['high'])
  })

  test('"scheduled" returns only tasks with a scheduled date', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] sched ⏳ 2026-05-20',
        '- [ ] none',
      ].join('\n')),
    ]
    const q = parseTaskQuery('scheduled')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['sched'])
  })

  test('combined: priority above normal AND due before 2026-05-25', () => {
    const notes = [
      makeNote('n1', 'N', [
        '- [ ] keep ⏫ 📅 2026-05-20',
        '- [ ] wrong-prio 📅 2026-05-20',
        '- [ ] wrong-date ⏫ 📅 2026-05-30',
        '- [ ] no-date ⏫',
      ].join('\n')),
    ]
    const q = parseTaskQuery('priority above normal due before 2026-05-25')
    const result = executeTaskQuery(q, { notes, folders: [] })
    expect(result.map(r => r.text)).toEqual(['keep'])
  })
})

describe('groupTasks — sort by', () => {
  // Direct ExecutedTask construction since we want full control over the
  // metadata fields used by each sort key.
  function task(
    text: string,
    overrides: Partial<ExecutedTask> = {}
  ): ExecutedTask {
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
      recurrence: null,
      path: text,
      noteTitle: text,
      folderPath: '',
      noteCreatedAt: 0,
      tags: [],
      ...overrides,
    }
  }

  test('sort by due → ascending, nulls last', () => {
    const tasks = [
      task('c', { dueDate: '2026-05-22' }),
      task('a', { dueDate: '2026-05-20' }),
      task('no-due'),
      task('b', { dueDate: '2026-05-21' }),
    ]
    const groups = groupTasks(tasks, [], 'due')
    expect(groups[0].tasks.map(t => t.text)).toEqual(['a', 'b', 'c', 'no-due'])
  })

  test('sort by priority → highest first, ties keep insertion order', () => {
    const tasks = [
      task('low1', { priority: 'low' }),
      task('high1', { priority: 'high' }),
      task('highest1', { priority: 'highest' }),
      task('high2', { priority: 'high' }),
      task('normal1'),
    ]
    const groups = groupTasks(tasks, [], 'priority')
    expect(groups[0].tasks.map(t => t.text)).toEqual([
      'highest1', 'high1', 'high2', 'normal1', 'low1',
    ])
  })

  test('sort by created → newest first, line-order ties', () => {
    const tasks = [
      task('old', { noteCreatedAt: 100 }),
      task('newA', { noteCreatedAt: 300 }),
      task('newB', { noteCreatedAt: 300 }),  // tie with newA
      task('mid', { noteCreatedAt: 200 }),
    ]
    const groups = groupTasks(tasks, [], 'created')
    expect(groups[0].tasks.map(t => t.text)).toEqual(['newA', 'newB', 'mid', 'old'])
  })

  test('sort by status → incomplete before completed', () => {
    const tasks = [
      task('done1', { completed: true }),
      task('open1'),
      task('done2', { completed: true }),
      task('open2'),
    ]
    const groups = groupTasks(tasks, [], 'status')
    expect(groups[0].tasks.map(t => t.text)).toEqual(['open1', 'open2', 'done1', 'done2'])
  })

  test('sort by title → alphabetical by noteTitle', () => {
    const tasks = [
      task('t1', { noteTitle: 'Charlie' }),
      task('t2', { noteTitle: 'alpha' }),
      task('t3', { noteTitle: 'bravo' }),
    ]
    const groups = groupTasks(tasks, [], 'title')
    expect(groups[0].tasks.map(t => t.noteTitle)).toEqual(['alpha', 'bravo', 'Charlie'])
  })

  test('sort applies within each group', () => {
    const tasks = [
      task('aLate',  { folderPath: 'A', dueDate: '2026-05-22' }),
      task('aEarly', { folderPath: 'A', dueDate: '2026-05-20' }),
      task('bLate',  { folderPath: 'B', dueDate: '2026-05-30' }),
      task('bEarly', { folderPath: 'B', dueDate: '2026-05-19' }),
    ]
    const groups = groupTasks(tasks, ['folder'], 'due')
    const a = groups.find(g => g.keys[0] === 'A')!
    const b = groups.find(g => g.keys[0] === 'B')!
    expect(a.tasks.map(t => t.text)).toEqual(['aEarly', 'aLate'])
    expect(b.tasks.map(t => t.text)).toEqual(['bEarly', 'bLate'])
  })
})

describe('groupTasks — group by tag / priority', () => {
  function task(
    text: string,
    overrides: Partial<ExecutedTask> = {}
  ): ExecutedTask {
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
      recurrence: null,
      path: text,
      noteTitle: text,
      folderPath: '',
      noteCreatedAt: 0,
      tags: [],
      ...overrides,
    }
  }

  test('group by tag → one bucket per distinct tag; tagless tasks get "(no tag)"', () => {
    const tasks = [
      task('a', { tags: ['work'] }),
      task('b', { tags: ['work', 'urgent'] }),  // appears in both buckets
      task('c', { tags: ['personal'] }),
      task('d'),                                 // no tag
    ]
    const groups = groupTasks(tasks, ['tag'])
    const keys = groups.map(g => g.keys[0]).sort()
    expect(keys).toEqual(['(no tag)', 'personal', 'urgent', 'work'])
    const work = groups.find(g => g.keys[0] === 'work')!
    expect(work.tasks.map(t => t.text).sort()).toEqual(['a', 'b'])
    const urgent = groups.find(g => g.keys[0] === 'urgent')!
    expect(urgent.tasks.map(t => t.text)).toEqual(['b'])
    const none = groups.find(g => g.keys[0] === '(no tag)')!
    expect(none.tasks.map(t => t.text)).toEqual(['d'])
  })

  test('group by priority → buckets ordered highest → lowest', () => {
    const tasks = [
      task('a', { priority: 'low' }),
      task('b', { priority: 'highest' }),
      task('c', { priority: 'normal' }),
      task('d', { priority: 'high' }),
      task('e', { priority: 'lowest' }),
    ]
    const groups = groupTasks(tasks, ['priority'])
    expect(groups.map(g => g.keys[0])).toEqual([
      'highest', 'high', 'normal', 'low', 'lowest',
    ])
  })

  test('group by priority + sort by due within each priority bucket', () => {
    const tasks = [
      task('hL', { priority: 'high',    dueDate: '2026-05-22' }),
      task('hE', { priority: 'high',    dueDate: '2026-05-20' }),
      task('xL', { priority: 'highest', dueDate: '2026-05-30' }),
      task('xE', { priority: 'highest', dueDate: '2026-05-19' }),
    ]
    const groups = groupTasks(tasks, ['priority'], 'due')
    expect(groups[0].keys[0]).toBe('highest')
    expect(groups[0].tasks.map(t => t.text)).toEqual(['xE', 'xL'])
    expect(groups[1].keys[0]).toBe('high')
    expect(groups[1].tasks.map(t => t.text)).toEqual(['hE', 'hL'])
  })
})

describe('explainQuery — new clauses', () => {
  test('explains due-date filters', () => {
    expect(explainQuery(parseTaskQuery('due before 2026-05-20'))).toContain('due before 2026-05-20')
    expect(explainQuery(parseTaskQuery('no due date'))).toContain('no due date')
  })

  test('explains priority filters', () => {
    expect(explainQuery(parseTaskQuery('priority above normal'))).toContain('priority above normal')
    expect(explainQuery(parseTaskQuery('priority is highest'))).toContain('priority is highest')
  })

  test('explains sort by', () => {
    expect(explainQuery(parseTaskQuery('sort by due'))).toContain('sort by due')
  })

  test('explains group by tag / priority', () => {
    expect(explainQuery(parseTaskQuery('group by tag'))).toContain('group by tag')
    expect(explainQuery(parseTaskQuery('group by priority'))).toContain('group by priority')
  })
})
