// noteser-kanban v0.1.0
//
// Closes issue #122. A kanban board surfaced as a fullscreen view.
// Notes are grouped by their YAML frontmatter `status:` field
// (Obsidian convention). Columns default to Todo / Doing / Done when
// no notes carry a status yet; once any do, the vault's distinct
// status values become the columns. The user can override the column
// list with a comma-separated string in the settings popover; the
// override persists via ctx.setSetting('columns', csv).
//
// Drag-and-drop is intentionally absent: the v1.2 VNode set has no
// pointer events (see docs/plugins-v1.2-impl-notes.md, post-v1.2
// "VNode event delivery" — only onClick / onChange / onSubmit /
// onKeyDown survive postMessage). Each card carries a "Move to..."
// button that opens a small radio overlay; selecting a column writes
// the new status via ctx.vault.write.updateNote.
//
// Self-contained ES module — the Worker dynamic-imports via Blob URL.
// No relative imports, no SDK runtime dependency.
//
// ─── Pure logic: kept mirrored in src/plugins/kanbanPluginLogic.ts so
// the Jest tests can import the TS version. Any change here must be
// applied there too. ─────────────────────────────────────────────────

const DEFAULT_COLUMNS = ['Todo', 'Doing', 'Done']
const UNSORTED_COLUMN = 'Unsorted'

function extractStatus(note) {
  const fm = note && note.frontmatter
  if (!fm) return null
  if (!Object.prototype.hasOwnProperty.call(fm, 'status')) return null
  const raw = fm.status
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) {
    const joined = raw.map((x) => String(x)).join(', ').trim()
    return joined.length > 0 ? joined : null
  }
  const s = String(raw).trim()
  return s.length > 0 ? s : null
}

function parseColumnsCsv(csv) {
  if (typeof csv !== 'string') return []
  const seen = new Set()
  const out = []
  for (const piece of csv.split(',')) {
    const t = piece.trim()
    if (t.length === 0) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function resolveColumns(notes, customCsv) {
  const parsed = parseColumnsCsv(customCsv || '')
  if (parsed.length > 0) return parsed
  const seen = new Set()
  const out = []
  for (const n of notes) {
    const s = extractStatus(n)
    if (s === null) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  if (out.length > 0) {
    out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    return out
  }
  return DEFAULT_COLUMNS.slice()
}

function groupByStatus(notes, columns) {
  const buckets = {}
  for (const c of columns) buckets[c] = []
  buckets[UNSORTED_COLUMN] = []
  const lookup = new Map()
  for (const c of columns) lookup.set(c.toLowerCase(), c)
  for (const n of notes) {
    const s = extractStatus(n)
    if (s === null) {
      buckets[UNSORTED_COLUMN].push(n)
      continue
    }
    const hit = lookup.get(s.toLowerCase())
    if (hit) buckets[hit].push(n)
    else buckets[UNSORTED_COLUMN].push(n)
  }
  return buckets
}

function extractTagsFromBody(body) {
  if (!body) return []
  const out = []
  const re = /(^|[^\w/])#([A-Za-z][\w-]*)/g
  let m
  while ((m = re.exec(body)) !== null) out.push(m[2].toLowerCase())
  return out
}

function ciIncludes(haystack, needle) {
  if (!needle) return true
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function filterNotes(notes, query) {
  const q = (query || '').trim()
  if (q.length === 0) return notes.slice()
  return notes.filter((n) => {
    if (ciIncludes(n.title || '', q)) return true
    const status = extractStatus(n) || ''
    if (ciIncludes(status, q)) return true
    for (const tag of extractTagsFromBody(n.body)) {
      if (ciIncludes(tag, q)) return true
    }
    return false
  })
}

function moveTargets(columns, fromColumn) {
  const out = []
  for (const c of columns) {
    if (c.toLowerCase() === fromColumn.toLowerCase()) continue
    out.push(c)
  }
  if (fromColumn.toLowerCase() !== UNSORTED_COLUMN.toLowerCase()) {
    out.push(UNSORTED_COLUMN)
  }
  return out
}

function buildMovePatch(existing, targetColumn) {
  const base = { ...(existing || {}) }
  if (targetColumn.toLowerCase() === UNSORTED_COLUMN.toLowerCase()) {
    delete base.status
    return base
  }
  base.status = targetColumn
  return base
}

// ─── VNode helpers ──────────────────────────────────────────────────

function txt(value) {
  return { tag: 'text', value }
}

function btn(label, eventName, opts) {
  const o = opts || {}
  return {
    tag: 'button',
    label,
    variant: o.variant || 'default',
    disabled: !!o.disabled,
    onClick: { kind: 'emit', event: eventName, payload: o.payload },
  }
}

function row(children, gap) {
  return { tag: 'box', gap: gap !== undefined ? gap : 1, children }
}

function col(children, gap) {
  return { tag: 'box', gap: gap !== undefined ? gap : 1, children }
}

// ─── Date formatting ────────────────────────────────────────────────

function formatDate(ms) {
  if (!ms || typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  try {
    return new Date(ms).toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

// ─── Perf instrumentation (mirrors graph plugin) ────────────────────

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()
}

// ─── Renderer ───────────────────────────────────────────────────────

function renderCard(note, columnName, state) {
  const isPickerOpen = state.movePickerCardId === note.id
  const date = formatDate(note.updatedAt)

  const head = {
    tag: 'link',
    label: note.title || '(untitled)',
    href: { kind: 'note', noteId: note.id },
  }

  const children = [head]
  if (date) children.push(txt(date))

  if (!isPickerOpen) {
    children.push(
      btn('Move to...', 'card.move.open', {
        variant: 'ghost',
        payload: { noteId: note.id, fromColumn: columnName },
      }),
    )
  } else {
    const targets = moveTargets(state.columns, columnName)
    if (targets.length === 0) {
      children.push(txt('No other columns to move to. Add one in Settings.'))
    } else {
      children.push({
        tag: 'radio',
        group: `move-${note.id}`,
        value: '',
        options: targets.map((t) => ({ value: t, label: t })),
        onChange: {
          kind: 'emit',
          event: 'card.move.pick',
          payload: { noteId: note.id, fromColumn: columnName },
        },
      })
    }
    children.push(
      btn('Cancel', 'card.move.cancel', {
        variant: 'ghost',
        payload: { noteId: note.id },
      }),
    )
  }

  return { tag: 'box', gap: 1, children }
}

function renderColumn(name, notes, state) {
  const cards = notes.map((n) => renderCard(n, name, state))
  const items =
    cards.length === 0
      ? [txt('No notes here.')]
      : cards

  return col(
    [
      txt(`${name} (${notes.length})`),
      { tag: 'list', ordered: false, items },
    ],
    2,
  )
}

function renderSettingsPopover(state) {
  return col(
    [
      txt('Custom columns'),
      txt('Comma-separated. Leave blank to fall back to the vault statuses or Todo, Doing, Done.'),
      {
        tag: 'input',
        type: 'text',
        value: state.draftColumnsCsv,
        placeholder: 'Todo, Doing, Done',
        onChange: { kind: 'emit', event: 'settings.columns.draft' },
      },
      row(
        [
          btn('Save', 'settings.columns.save', { variant: 'primary' }),
          btn('Cancel', 'settings.close', { variant: 'ghost' }),
        ],
        1,
      ),
    ],
    2,
  )
}

function renderBoard(state) {
  const visible = filterNotes(state.notes, state.filter)
  const columns = state.columns
  const buckets = groupByStatus(visible, columns)

  const topBar = row(
    [
      {
        tag: 'input',
        type: 'search',
        value: state.filter || '',
        placeholder: 'filter notes by title, tag, or status',
        onChange: { kind: 'emit', event: 'board.filter' },
      },
      btn('Refresh', 'board.refresh', { variant: 'ghost' }),
      btn(state.settingsOpen ? 'Close settings' : 'Settings', 'settings.toggle', {
        variant: 'ghost',
      }),
    ],
    2,
  )

  const children = [topBar]

  if (state.settingsOpen) {
    children.push(renderSettingsPopover(state))
  }

  // Empty-state callout: vault has no statuses AND no user override.
  const customCsv = (state.customColumnsCsv || '').trim()
  const vaultHasStatus = state.notes.some((n) => extractStatus(n) !== null)
  if (!vaultHasStatus && customCsv.length === 0) {
    children.push({
      tag: 'callout',
      kind: 'info',
      title: 'No notes with status frontmatter yet',
      body:
        'Add `status: todo` to the frontmatter of any note to get started. ' +
        'Default columns (Todo, Doing, Done) will be replaced by the values you use in your vault.',
    })
  }

  // Perf banner.
  if (state.lastDeriveMs !== null) {
    children.push(
      txt(
        `Board derived in ${state.lastDeriveMs.toFixed(1)} ms over ${state.notes.length} notes.`,
      ),
    )
  }

  // Column strip — a row of column VNodes. The renderer lays each one
  // out as a flex item.
  const stripChildren = []
  for (const c of columns) {
    stripChildren.push(renderColumn(c, buckets[c] || [], state))
  }
  stripChildren.push(renderColumn(UNSORTED_COLUMN, buckets[UNSORTED_COLUMN] || [], state))

  children.push(row(stripChildren, 3))

  return { tag: 'box', gap: 3, children }
}

// ─── State ──────────────────────────────────────────────────────────

const STATE = {
  open: false,
  notes: [],
  columns: DEFAULT_COLUMNS.slice(),
  customColumnsCsv: '',
  draftColumnsCsv: '',
  filter: '',
  settingsOpen: false,
  movePickerCardId: null,
  lastDeriveMs: null,
}

// Debounce / re-derive scheduling.
let filterDebounceTimer = null
let vaultChangeDebounceTimer = null

function clearTimers() {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer)
    filterDebounceTimer = null
  }
  if (vaultChangeDebounceTimer) {
    clearTimeout(vaultChangeDebounceTimer)
    vaultChangeDebounceTimer = null
  }
}

function rerender(ctx) {
  if (!STATE.open) return
  const t0 = nowMs()
  ctx.setFullscreenContent('kanban', renderBoard(STATE))
  const t1 = nowMs()
  STATE.lastDeriveMs = t1 - t0
}

async function loadAllNotes(ctx) {
  try {
    const notes = await ctx.vault.read.getAllNotes()
    STATE.notes = notes.slice()
  } catch (err) {
    const msg = String((err && err.message) || err)
    if (/use stream/i.test(msg)) {
      const collected = []
      try {
        for await (const chunk of ctx.vault.read.stream({ chunkSize: 200 })) {
          for (const n of chunk) collected.push(n)
        }
        STATE.notes = collected
      } catch (streamErr) {
        ctx.notify(
          `Kanban: stream failed: ${
            (streamErr && streamErr.message) || String(streamErr)
          }`,
        )
        return
      }
    } else {
      ctx.notify(`Kanban: getAllNotes failed: ${msg}`)
      return
    }
  }
  STATE.columns = resolveColumns(STATE.notes, STATE.customColumnsCsv)
}

async function rederive(ctx) {
  const t0 = nowMs()
  await loadAllNotes(ctx)
  rerender(ctx)
  const t1 = nowMs()
  STATE.lastDeriveMs = t1 - t0
  // Log for perf verification — same shape as the graph plugin.
  // eslint-disable-next-line no-console
  console.log(
    `[noteser-kanban] board derive: ${(t1 - t0).toFixed(1)} ms over ${STATE.notes.length} notes`,
  )
}

function updateSingleNote(ctx, noteId) {
  // Best-effort single-note refresh: pull only that note and replace
  // it in the in-memory snapshot. Falls back to a full re-derive on
  // any error.
  if (!STATE.open) return
  ctx.vault.read
    .getNote(noteId)
    .then((fresh) => {
      if (!STATE.open) return
      const idx = STATE.notes.findIndex((n) => n.id === noteId)
      if (fresh === null) {
        if (idx >= 0) STATE.notes.splice(idx, 1)
      } else if (idx >= 0) {
        STATE.notes[idx] = fresh
      } else {
        STATE.notes.push(fresh)
      }
      // Recompute columns only when the user has not pinned them
      // (custom CSV wins).
      STATE.columns = resolveColumns(STATE.notes, STATE.customColumnsCsv)
      rerender(ctx)
    })
    .catch(() => {
      void rederive(ctx)
    })
}

// ─── Move handlers ──────────────────────────────────────────────────

async function commitMove(ctx, noteId, targetColumn) {
  const note = STATE.notes.find((n) => n.id === noteId)
  if (!note) {
    ctx.notify('Kanban: note not found.')
    return
  }
  const patch = buildMovePatch(note.frontmatter, targetColumn)
  try {
    await ctx.vault.write.updateNote(noteId, { frontmatter: patch })
    // Optimistic local update so the card moves immediately even if
    // the vault-event debounce window has not flushed yet.
    note.frontmatter = patch
    STATE.movePickerCardId = null
    rerender(ctx)
  } catch (err) {
    ctx.notify(
      `Kanban: move failed: ${
        (err && err.message) || String(err)
      }`,
    )
    STATE.movePickerCardId = null
    rerender(ctx)
  }
}

// ─── Event router ───────────────────────────────────────────────────

function attachVNodeEvents(ctx) {
  ctx.onVNodeEvent(({ event, payload, source }) => {
    if (!source || source.kind !== 'fullscreen' || source.viewId !== 'kanban') return
    const p = payload && typeof payload === 'object' ? payload : {}

    if (event === 'board.filter') {
      const next = String(p.value || '')
      // 150 ms debounce.
      if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
      filterDebounceTimer = setTimeout(() => {
        filterDebounceTimer = null
        STATE.filter = next
        rerender(ctx)
      }, 150)
      return
    }

    if (event === 'board.refresh') {
      void rederive(ctx)
      return
    }

    if (event === 'settings.toggle') {
      STATE.settingsOpen = !STATE.settingsOpen
      STATE.draftColumnsCsv = STATE.customColumnsCsv
      rerender(ctx)
      return
    }

    if (event === 'settings.close') {
      STATE.settingsOpen = false
      rerender(ctx)
      return
    }

    if (event === 'settings.columns.draft') {
      STATE.draftColumnsCsv = String(p.value || '')
      // Don’t re-render on every keystroke; let the controlled input
      // own the caret. Re-render on save / cancel.
      return
    }

    if (event === 'settings.columns.save') {
      STATE.customColumnsCsv = STATE.draftColumnsCsv
      try {
        ctx.setSetting('columns', STATE.customColumnsCsv)
      } catch (err) {
        ctx.notify(
          `Kanban: could not save settings: ${
            (err && err.message) || String(err)
          }`,
        )
      }
      STATE.columns = resolveColumns(STATE.notes, STATE.customColumnsCsv)
      STATE.settingsOpen = false
      rerender(ctx)
      return
    }

    if (event === 'card.move.open') {
      STATE.movePickerCardId = String(p.noteId || '')
      rerender(ctx)
      return
    }

    if (event === 'card.move.cancel') {
      STATE.movePickerCardId = null
      rerender(ctx)
      return
    }

    if (event === 'card.move.pick') {
      const noteId = String(p.noteId || '')
      const target = String(p.value || '')
      if (!noteId || !target) return
      void commitMove(ctx, noteId, target)
      return
    }
  })
}

// ─── Plugin definition ──────────────────────────────────────────────

export default {
  id: 'noteser-kanban',
  name: 'Kanban',
  version: '0.1.0',
  author: 'Noteser',
  description:
    'Kanban board over the YAML frontmatter status field. Notes are grouped into user-defined columns; a per-card move button writes the new status back to the frontmatter.',
  permissions: ['vault.read.all', 'vault.write', 'vault.events'],
  surfaces: {
    fullscreenViews: [{ id: 'kanban', title: 'Kanban' }],
    commands: [{ id: 'open-kanban', title: 'Open Kanban board' }],
  },

  onActivate(ctx) {
    attachVNodeEvents(ctx)

    // Re-derive the board on any vault change while the modal is
    // open. The host already debounces this event at 250 ms; we keep
    // a second microdebounce to coalesce burst-of-saves into one
    // re-derive on the next tick.
    ctx.vault.events.onVaultChange(() => {
      if (!STATE.open) return
      if (vaultChangeDebounceTimer) clearTimeout(vaultChangeDebounceTimer)
      vaultChangeDebounceTimer = setTimeout(() => {
        vaultChangeDebounceTimer = null
        void rederive(ctx)
      }, 0)
    })

    // Single-note save: update just that card without rebuilding the
    // whole board.
    ctx.vault.events.onNoteSaved((noteId) => {
      updateSingleNote(ctx, noteId)
    })
  },

  async onCommand(commandId, ctx) {
    if (commandId !== 'open-kanban') return
    try {
      await ctx.openFullscreen('kanban')
    } catch (err) {
      ctx.notify((err && err.message) || 'Could not open Kanban board.')
    }
  },

  async onFullscreenMount(viewId, ctx) {
    if (viewId !== 'kanban') return
    STATE.open = true
    STATE.filter = ''
    STATE.settingsOpen = false
    STATE.movePickerCardId = null
    // Pull persisted column CSV.
    try {
      const csv = ctx.getSetting('columns')
      STATE.customColumnsCsv = typeof csv === 'string' ? csv : ''
      STATE.draftColumnsCsv = STATE.customColumnsCsv
    } catch {
      STATE.customColumnsCsv = ''
      STATE.draftColumnsCsv = ''
    }
    await rederive(ctx)
  },

  onFullscreenUnmount(viewId) {
    if (viewId !== 'kanban') return
    STATE.open = false
    clearTimers()
  },
}

// Test-only named exports. The worker reads only the default export,
// so these cost nothing at runtime; the Jest suite imports them to
// drive the move + filter handlers without bringing the worker up.
export {
  extractStatus,
  parseColumnsCsv,
  resolveColumns,
  groupByStatus,
  filterNotes,
  moveTargets,
  buildMovePatch,
  DEFAULT_COLUMNS,
  UNSORTED_COLUMN,
}
