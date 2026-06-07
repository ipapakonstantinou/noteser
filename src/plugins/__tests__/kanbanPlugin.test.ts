// Tests for the `noteser-kanban` plugin's pure status extraction,
// column grouping, filter, and move-to logic. The production code
// is in `public/plugins/noteser-kanban/main.js`; this test file
// imports the TypeScript mirror in `../kanbanPluginLogic.ts` so we
// don't have to bring the Worker bridge up to exercise the math.
//
// Any change to the production logic in main.js must land in the
// mirror or these tests will go stale silently. Keep the two in
// lock step.

import {
  extractStatus,
  parseColumnsCsv,
  resolveColumns,
  groupByStatus,
  filterNotes,
  moveTargets,
  buildMovePatch,
  DEFAULT_COLUMNS,
  UNSORTED_COLUMN,
  type KanbanNote,
} from '../kanbanPluginLogic'

const noteOf = (
  id: string,
  title: string,
  frontmatter: Record<string, unknown> | null,
  body = '',
  folderPath = '',
): KanbanNote => ({
  id,
  title,
  folderPath,
  body,
  frontmatter,
  updatedAt: 0,
})

describe('extractStatus', () => {
  it('returns the trimmed string when frontmatter has a status', () => {
    expect(extractStatus({ frontmatter: { status: 'Todo' } })).toBe('Todo')
    expect(extractStatus({ frontmatter: { status: '  Doing  ' } })).toBe('Doing')
  })

  it('returns null when frontmatter is null or missing the key', () => {
    expect(extractStatus({ frontmatter: null })).toBeNull()
    expect(extractStatus({ frontmatter: {} })).toBeNull()
    expect(extractStatus({ frontmatter: { other: 'x' } })).toBeNull()
  })

  it('returns null on empty / whitespace / null / undefined values', () => {
    expect(extractStatus({ frontmatter: { status: '' } })).toBeNull()
    expect(extractStatus({ frontmatter: { status: '   ' } })).toBeNull()
    expect(extractStatus({ frontmatter: { status: null } })).toBeNull()
    expect(extractStatus({ frontmatter: { status: undefined } })).toBeNull()
  })

  it('coerces non-string values to strings', () => {
    expect(extractStatus({ frontmatter: { status: 3 } })).toBe('3')
    expect(extractStatus({ frontmatter: { status: true } })).toBe('true')
  })

  it('joins array statuses with a comma', () => {
    expect(extractStatus({ frontmatter: { status: ['todo', 'review'] } })).toBe(
      'todo, review',
    )
    expect(extractStatus({ frontmatter: { status: [] } })).toBeNull()
  })
})

describe('parseColumnsCsv', () => {
  it('trims, drops empties, and preserves order', () => {
    expect(parseColumnsCsv('Todo, Doing , Done')).toEqual(['Todo', 'Doing', 'Done'])
    expect(parseColumnsCsv(' , Backlog ,,  In progress')).toEqual([
      'Backlog',
      'In progress',
    ])
  })

  it('dedupes case-insensitively, keeping first occurrence', () => {
    expect(parseColumnsCsv('Todo, todo, TODO, Done')).toEqual(['Todo', 'Done'])
  })

  it('returns an empty array for empty / non-string input', () => {
    expect(parseColumnsCsv('')).toEqual([])
    expect(parseColumnsCsv('   ')).toEqual([])
    expect(parseColumnsCsv(null as unknown as string)).toEqual([])
    expect(parseColumnsCsv(undefined as unknown as string)).toEqual([])
  })
})

describe('resolveColumns', () => {
  it('honours user CSV when provided', () => {
    expect(resolveColumns([], 'A, B, C')).toEqual(['A', 'B', 'C'])
    // Even when the vault has statuses, CSV wins.
    const notes = [noteOf('1', 'x', { status: 'Done' })]
    expect(resolveColumns(notes, 'Backlog, Doing')).toEqual(['Backlog', 'Doing'])
  })

  it('falls back to vault-derived columns sorted case-insensitively', () => {
    const notes = [
      noteOf('1', 'a', { status: 'doing' }),
      noteOf('2', 'b', { status: 'Todo' }),
      noteOf('3', 'c', { status: 'Done' }),
    ]
    // localeCompare on lowercased keys: doing < done < todo.
    expect(resolveColumns(notes, '')).toEqual(['doing', 'Done', 'Todo'])
  })

  it('dedupes vault columns case-insensitively (first-seen casing wins)', () => {
    const notes = [
      noteOf('1', 'a', { status: 'todo' }),
      noteOf('2', 'b', { status: 'TODO' }),
      noteOf('3', 'c', { status: 'Todo' }),
    ]
    expect(resolveColumns(notes, '')).toEqual(['todo'])
  })

  it('falls back to DEFAULT_COLUMNS when no notes carry status', () => {
    const notes = [noteOf('1', 'a', null), noteOf('2', 'b', { other: 'x' })]
    expect(resolveColumns(notes, '')).toEqual([...DEFAULT_COLUMNS])
  })

  it('falls back to DEFAULT_COLUMNS for an empty vault', () => {
    expect(resolveColumns([], '')).toEqual([...DEFAULT_COLUMNS])
  })
})

describe('groupByStatus', () => {
  const vault = [
    noteOf('1', 'A', { status: 'Todo' }),
    noteOf('2', 'B', { status: 'Doing' }),
    noteOf('3', 'C', { status: 'Done' }),
    noteOf('4', 'D', null),
    noteOf('5', 'E', { status: 'Archived' }), // not in columns
  ]

  it('places notes into their declared columns', () => {
    const out = groupByStatus(vault, ['Todo', 'Doing', 'Done'])
    expect(out['Todo'].map((n) => n.id)).toEqual(['1'])
    expect(out['Doing'].map((n) => n.id)).toEqual(['2'])
    expect(out['Done'].map((n) => n.id)).toEqual(['3'])
  })

  it('places unsorted + non-matching notes into UNSORTED_COLUMN', () => {
    const out = groupByStatus(vault, ['Todo', 'Doing', 'Done'])
    const unsortedIds = out[UNSORTED_COLUMN].map((n) => n.id).sort()
    expect(unsortedIds).toEqual(['4', '5'])
  })

  it('matches case-insensitively against column names', () => {
    const notes = [
      noteOf('1', 'A', { status: 'TODO' }),
      noteOf('2', 'B', { status: 'doing' }),
    ]
    const out = groupByStatus(notes, ['Todo', 'Doing'])
    expect(out['Todo'].map((n) => n.id)).toEqual(['1'])
    expect(out['Doing'].map((n) => n.id)).toEqual(['2'])
  })

  it('always produces every declared column plus UNSORTED_COLUMN', () => {
    const out = groupByStatus([], ['Todo', 'Doing', 'Done'])
    expect(Object.keys(out).sort()).toEqual(
      ['Doing', 'Done', 'Todo', UNSORTED_COLUMN].sort(),
    )
    for (const c of ['Todo', 'Doing', 'Done', UNSORTED_COLUMN]) {
      expect(out[c]).toEqual([])
    }
  })
})

describe('filterNotes', () => {
  const vault: KanbanNote[] = [
    noteOf('1', 'Alpha rust', { status: 'Todo' }, 'body with #project tag'),
    noteOf('2', 'Beta',       { status: 'Doing' }, 'no tags here'),
    noteOf('3', 'Gamma',      { status: 'Done' },  '#followup #rust'),
    noteOf('4', 'Delta',      null,                'just text'),
  ]

  it('returns every note when the filter is empty', () => {
    expect(filterNotes(vault, '').map((n) => n.id)).toEqual(['1', '2', '3', '4'])
  })

  it('matches by title substring', () => {
    expect(filterNotes(vault, 'alp').map((n) => n.id)).toEqual(['1'])
  })

  it('matches by status', () => {
    expect(filterNotes(vault, 'doing').map((n) => n.id)).toEqual(['2'])
  })

  it('matches by body tag', () => {
    expect(filterNotes(vault, 'project').map((n) => n.id)).toEqual(['1'])
    expect(filterNotes(vault, 'rust').map((n) => n.id).sort()).toEqual(['1', '3'])
  })

  it('is case-insensitive', () => {
    expect(filterNotes(vault, 'PROJECT').map((n) => n.id)).toEqual(['1'])
    expect(filterNotes(vault, 'DOING').map((n) => n.id)).toEqual(['2'])
  })

  it('does NOT match folder paths (kanban scope is title / tag / status)', () => {
    const v = [noteOf('1', 'X', null, '', 'Projects/Web')]
    expect(filterNotes(v, 'projects')).toEqual([])
  })

  it('returns an empty array on no match', () => {
    expect(filterNotes(vault, 'nope-no-such-thing')).toEqual([])
  })
})

describe('moveTargets', () => {
  it('excludes the source column and appends UNSORTED_COLUMN', () => {
    expect(moveTargets(['Todo', 'Doing', 'Done'], 'Todo')).toEqual([
      'Doing',
      'Done',
      UNSORTED_COLUMN,
    ])
  })

  it('does not append UNSORTED_COLUMN twice when the source IS Unsorted', () => {
    expect(moveTargets(['Todo', 'Doing'], UNSORTED_COLUMN)).toEqual(['Todo', 'Doing'])
  })

  it('compares the source case-insensitively', () => {
    expect(moveTargets(['Todo', 'Doing'], 'TODO')).toEqual(['Doing', UNSORTED_COLUMN])
  })
})

describe('buildMovePatch', () => {
  it('writes the target column to the status key', () => {
    const out = buildMovePatch({ status: 'Todo', tags: ['x'] }, 'Doing')
    expect(out).toEqual({ status: 'Doing', tags: ['x'] })
  })

  it('preserves all other keys', () => {
    const out = buildMovePatch(
      { status: 'Todo', tags: ['x'], priority: 3 },
      'Done',
    )
    expect(out).toEqual({ status: 'Done', tags: ['x'], priority: 3 })
  })

  it('removes the status key when moving to UNSORTED_COLUMN', () => {
    const out = buildMovePatch({ status: 'Doing', tags: ['x'] }, UNSORTED_COLUMN)
    expect(out).toEqual({ tags: ['x'] })
    expect('status' in out).toBe(false)
  })

  it('handles null existing frontmatter', () => {
    expect(buildMovePatch(null, 'Doing')).toEqual({ status: 'Doing' })
    expect(buildMovePatch(null, UNSORTED_COLUMN)).toEqual({})
  })

  it('does not mutate the input frontmatter', () => {
    const fm = { status: 'Todo', tags: ['x'] }
    buildMovePatch(fm, 'Done')
    expect(fm).toEqual({ status: 'Todo', tags: ['x'] })
  })
})

// ─── Integration: drive the production main.js end-to-end so we
// catch any mirror-drift in the move-to write path. ──────────────────

describe('main.js — move-to writes via vault.write.updateNote', () => {
  it('calls updateNote with the new status frontmatter and clears the picker', async () => {
    type FmPatch = { frontmatter?: Record<string, unknown> }
    const updateCalls: Array<{ id: string; patch: FmPatch }> = []
    const settings = new Map<string, unknown>()
    const notes = [
      noteOf('n1', 'Alpha', { status: 'Todo', tags: ['x'] }),
      noteOf('n2', 'Beta', null),
    ]

    const ctx: Record<string, unknown> = {
      activeNote: null,
      notes: notes.map((n) => ({ id: n.id, title: n.title, folderPath: n.folderPath })),
      setFullscreenContent: jest.fn(),
      setPanelContent: jest.fn(),
      notify: jest.fn(),
      getSetting: (k: string) => settings.get(k),
      setSetting: (k: string, v: unknown) => {
        settings.set(k, v)
      },
      onVNodeEvent: jest.fn(() => () => {}),
      openFullscreen: jest.fn(() => Promise.resolve()),
      closeFullscreen: jest.fn(),
      vault: {
        read: {
          getAllNotes: () => Promise.resolve(notes),
          getNote: (id: string) =>
            Promise.resolve(notes.find((n) => n.id === id) || null),
          stream: () => {
            async function* g() {
              yield notes
            }
            return g()
          },
        },
        write: {
          updateNote: (id: string, patch: FmPatch) => {
            updateCalls.push({ id, patch })
            const n = notes.find((nn) => nn.id === id)
            if (n && patch.frontmatter !== undefined) {
              n.frontmatter = patch.frontmatter
            }
            return Promise.resolve()
          },
          createNote: jest.fn(),
          deleteNote: jest.fn(),
          createFolder: jest.fn(),
        },
        events: {
          onVaultChange: () => () => {},
          onNoteSaved: () => () => {},
          onActiveNoteChange: () => () => {},
        },
      },
    }

    const mod = await import(
      '../../../public/plugins/noteser-kanban/main.js'
    )
    const plugin = (mod as { default: Record<string, unknown> }).default

    // Capture the registered VNode event handler.
    let registered:
      | ((args: { event: string; payload: unknown; source: unknown }) => void)
      | null = null
    ;(ctx.onVNodeEvent as jest.Mock).mockImplementation((cb) => {
      registered = cb
      return () => {}
    })

    ;(plugin.onActivate as (c: unknown) => void)(ctx)
    await (plugin.onFullscreenMount as (id: string, c: unknown) => Promise<void>)(
      'kanban',
      ctx,
    )

    expect(registered).not.toBeNull()
    const fire = (event: string, payload: unknown) =>
      registered!({
        event,
        payload,
        source: { kind: 'fullscreen', viewId: 'kanban' },
      })

    // Open the move picker on n1, then pick "Doing".
    fire('card.move.open', { noteId: 'n1', fromColumn: 'Todo' })
    fire('card.move.pick', {
      noteId: 'n1',
      fromColumn: 'Todo',
      value: 'Doing',
    })
    // Let the awaited writes settle.
    await Promise.resolve()
    await Promise.resolve()

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe('n1')
    expect(updateCalls[0].patch.frontmatter).toEqual({
      status: 'Doing',
      tags: ['x'],
    })
  })

  it('persists the custom columns CSV via setSetting', async () => {
    const settings = new Map<string, unknown>()
    const ctx: Record<string, unknown> = {
      activeNote: null,
      notes: [],
      setFullscreenContent: jest.fn(),
      setPanelContent: jest.fn(),
      notify: jest.fn(),
      getSetting: (k: string) => settings.get(k),
      setSetting: (k: string, v: unknown) => {
        settings.set(k, v)
      },
      onVNodeEvent: jest.fn(() => () => {}),
      openFullscreen: jest.fn(() => Promise.resolve()),
      closeFullscreen: jest.fn(),
      vault: {
        read: {
          getAllNotes: () => Promise.resolve([]),
          getNote: () => Promise.resolve(null),
          stream: () => {
            async function* g() {
              yield []
            }
            return g()
          },
        },
        write: {
          updateNote: jest.fn(() => Promise.resolve()),
          createNote: jest.fn(),
          deleteNote: jest.fn(),
          createFolder: jest.fn(),
        },
        events: {
          onVaultChange: () => () => {},
          onNoteSaved: () => () => {},
          onActiveNoteChange: () => () => {},
        },
      },
    }

    const mod = await import(
      '../../../public/plugins/noteser-kanban/main.js'
    )
    const plugin = (mod as { default: Record<string, unknown> }).default

    let registered:
      | ((args: { event: string; payload: unknown; source: unknown }) => void)
      | null = null
    ;(ctx.onVNodeEvent as jest.Mock).mockImplementation((cb) => {
      registered = cb
      return () => {}
    })

    ;(plugin.onActivate as (c: unknown) => void)(ctx)
    await (plugin.onFullscreenMount as (id: string, c: unknown) => Promise<void>)(
      'kanban',
      ctx,
    )

    expect(registered).not.toBeNull()
    const fire = (event: string, payload: unknown) =>
      registered!({
        event,
        payload,
        source: { kind: 'fullscreen', viewId: 'kanban' },
      })

    fire('settings.toggle', {})
    fire('settings.columns.draft', { value: 'Backlog, Doing, Shipped' })
    fire('settings.columns.save', {})

    expect(settings.get('columns')).toBe('Backlog, Doing, Shipped')
  })
})
