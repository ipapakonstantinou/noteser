// noteser-properties v0.1.0
//
// Closes issue #72. Two surfaces:
//
//   1. Sidebar "Properties+" panel — edit the active note's frontmatter
//      (key + value rows; inline edit; "+ Add property" row). Saves
//      flow through ctx.vault.write.updateNote({ frontmatter }) so the
//      host's writeFrontmatter helper re-serialises the block and the
//      body stays untouched.
//
//   2. Fullscreen "Vault tables" view — Obsidian Bases-style table of
//      every note in the vault. Columns are inferred as the union of
//      all frontmatter keys present anywhere. Top input filters by
//      tag / status / anything (matches title, folderPath, every
//      stringified frontmatter value). Column headers are buttons —
//      click to sort. Click a row label to open the note (a `link`
//      VNode, intercepted via the PR #142 wikilink path). A "Save
//      current view as note" button exports the active table as
//      markdown via ctx.vault.write.createNote.
//
// Frontmatter source: the host parses each note's frontmatter and
// hands the plugin a `frontmatter` field on every NoteWithBody, so the
// plugin does not re-parse YAML. js-yaml is intentionally NOT a
// dependency.
//
// Type inference: per-column, we union every non-null value seen and
// pick a single column type — 'number' when every value is finite, or
// can be coerced via Number(); 'date' when every value matches an ISO
// date pattern; 'tag-array' when every value is an array of strings
// OR a 'tags'-shaped key string; otherwise 'string'.
//
// Self-contained ES module — the Worker dynamic-imports via Blob URL.
// No relative imports, no SDK runtime dependency.

// ─── Pure logic: kept mirrored in src/plugins/propertiesPluginLogic.ts
// so the Jest tests can import the TS version. Any change here must be
// applied there too. ─────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** Best-effort type inference for a single frontmatter value.
 *  Returned strings are the canonical column types we sort by. */
function inferValueType(v) {
  if (v === null || v === undefined) return 'empty'
  if (Array.isArray(v)) {
    // Treat as a tag-array only when every element is string-like.
    if (v.every((x) => typeof x === 'string')) return 'tag-array'
    return 'string'
  }
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number' && Number.isFinite(v)) return 'number'
  if (typeof v === 'string') {
    if (v.length === 0) return 'empty'
    if (ISO_DATE_RE.test(v)) return 'date'
    // Strings that look like ints / floats — accept negatives, no exponent.
    if (/^-?\d+(\.\d+)?$/.test(v)) return 'number'
    return 'string'
  }
  return 'string'
}

/** Reduce a column's seen types to a single canonical type.
 *  Precedence: tag-array > date > number > boolean > string. 'empty'
 *  is ignored unless it is the only value seen (in which case the
 *  column is dropped upstream). */
function reduceColumnType(seen) {
  if (seen.has('tag-array')) return 'tag-array'
  // Mixed string/date or string/number falls back to 'string' to keep
  // sort sane — the user's column is heterogeneous.
  const real = new Set([...seen].filter((t) => t !== 'empty'))
  if (real.size === 0) return 'string'
  if (real.size === 1) return [...real][0]
  // Allow date + string when 'tags' string sits next to 'date' ISO.
  // Conservative path: mixed → string.
  return 'string'
}

/** Infer a column descriptor per key, sorted with 'tags' first then
 *  alphabetical. Drops keys that only ever held empty values. */
function inferColumns(notes) {
  const keyTypes = new Map() // key -> Set<type>
  for (const n of notes) {
    const fm = n.frontmatter || {}
    for (const [k, v] of Object.entries(fm)) {
      if (!keyTypes.has(k)) keyTypes.set(k, new Set())
      keyTypes.get(k).add(inferValueType(v))
    }
  }
  const cols = []
  for (const [key, seen] of keyTypes) {
    // Drop columns where every seen value was empty.
    const hasReal = [...seen].some((t) => t !== 'empty')
    if (!hasReal) continue
    cols.push({ key, type: reduceColumnType(seen) })
  }
  cols.sort((a, b) => {
    if (a.key === 'tags') return -1
    if (b.key === 'tags') return 1
    return a.key.localeCompare(b.key)
  })
  return cols
}

/** Stringify a single value for display + filter matching. Arrays
 *  render as comma-separated; objects fall back to JSON. */
function valueToText(v) {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return '' }
  }
  return String(v)
}

/** True when the haystack contains the needle, case-insensitively. */
function ciIncludes(haystack, needle) {
  if (!needle) return true
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** Filter notes. Matches against title, folderPath, every column's
 *  stringified value. Empty filter returns the input unchanged. */
function filterNotes(notes, filter) {
  const q = (filter || '').trim()
  if (q.length === 0) return notes.slice()
  return notes.filter((n) => {
    if (ciIncludes(n.title || '', q)) return true
    if (ciIncludes(n.folderPath || '', q)) return true
    const fm = n.frontmatter || {}
    for (const v of Object.values(fm)) {
      if (ciIncludes(valueToText(v), q)) return true
    }
    return false
  })
}

/** Comparator for a single column type. */
function compareForType(type, a, b) {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1   // empties last
  if (bEmpty) return -1
  if (type === 'number') {
    const na = typeof a === 'number' ? a : Number(a)
    const nb = typeof b === 'number' ? b : Number(b)
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0
    if (Number.isNaN(na)) return 1
    if (Number.isNaN(nb)) return -1
    return na - nb
  }
  if (type === 'date') {
    const ta = Date.parse(String(a))
    const tb = Date.parse(String(b))
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
    if (Number.isNaN(ta)) return 1
    if (Number.isNaN(tb)) return -1
    return ta - tb
  }
  if (type === 'tag-array') {
    const sa = Array.isArray(a) ? a.join(', ') : String(a)
    const sb = Array.isArray(b) ? b.join(', ') : String(b)
    return sa.localeCompare(sb)
  }
  return String(a).localeCompare(String(b))
}

/** Sort notes by the given column (or title when key === '_title').
 *  Returns a new array. `direction` is 'asc' or 'desc'. */
function sortNotes(notes, columns, sortKey, direction) {
  const out = notes.slice()
  if (sortKey === '_title') {
    out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  } else if (sortKey === '_folder') {
    out.sort((a, b) => (a.folderPath || '').localeCompare(b.folderPath || ''))
  } else {
    const col = columns.find((c) => c.key === sortKey)
    const type = col ? col.type : 'string'
    out.sort((a, b) => {
      const va = a.frontmatter ? a.frontmatter[sortKey] : undefined
      const vb = b.frontmatter ? b.frontmatter[sortKey] : undefined
      return compareForType(type, va, vb)
    })
  }
  if (direction === 'desc') out.reverse()
  return out
}

/** Render the current table to a markdown table string. */
function tableToMarkdown(columns, rows) {
  const headers = ['Title', 'Folder', ...columns.map((c) => c.key)]
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ]
  for (const r of rows) {
    const cells = [
      r.title || '',
      r.folderPath || '',
      ...columns.map((c) => {
        const v = r.frontmatter ? r.frontmatter[c.key] : undefined
        return valueToText(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
      }),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
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
    onClick: { kind: 'emit', event: eventName, payload: o.payload },
  }
}

function row(children, gap) {
  return { tag: 'box', gap: gap !== undefined ? gap : 1, children }
}

// ─── Properties+ sidebar panel renderer ─────────────────────────────

/** Build the Properties+ panel VNode for a snapshot of the active note. */
function renderPropertiesPanel(state) {
  if (!state.activeNote) {
    return {
      tag: 'box', gap: 2, children: [
        txt('Properties+'),
        {
          tag: 'callout',
          kind: 'info',
          title: 'No note selected',
          body: 'Open a note to edit its frontmatter properties here.',
        },
      ],
    }
  }
  const fm = state.activeNote.frontmatter || {}
  const entries = Object.entries(fm)

  const children = [
    txt(`Properties+ · ${state.activeNote.title || '(untitled)'}`),
  ]

  if (entries.length === 0) {
    children.push({
      tag: 'callout',
      kind: 'note',
      title: 'No properties yet',
      body: 'This note has no frontmatter. Add a key + value below to create one.',
    })
  }

  for (const [key, value] of entries) {
    children.push(
      row([
        txt(key),
        {
          tag: 'input',
          type: 'text',
          value: valueToText(value),
          placeholder: `Value for ${key}`,
          onChange: {
            kind: 'emit',
            event: 'prop.edit',
            payload: { key },
          },
        },
        btn('Delete', 'prop.delete', { variant: 'ghost', payload: { key } }),
      ], 1),
    )
  }

  // Add property row.
  if (state.addOpen) {
    children.push(
      row([
        {
          tag: 'input',
          type: 'text',
          value: state.draftKey || '',
          placeholder: 'key (e.g. status)',
          onChange: { kind: 'emit', event: 'prop.draft.key' },
        },
        {
          tag: 'input',
          type: 'text',
          value: state.draftValue || '',
          placeholder: 'value (e.g. draft)',
          onChange: { kind: 'emit', event: 'prop.draft.value' },
        },
        btn('Save', 'prop.draft.save', { variant: 'primary' }),
        btn('Cancel', 'prop.draft.cancel', { variant: 'ghost' }),
      ], 1),
    )
  } else {
    children.push(btn('+ Add property', 'prop.add.open', { variant: 'primary' }))
  }

  return { tag: 'box', gap: 2, children }
}

// ─── Vault tables fullscreen renderer ───────────────────────────────

/** Build the Vault tables fullscreen VNode. */
function renderTablesView(state) {
  const columns = state.columns
  const visible = sortNotes(filterNotes(state.notes, state.filter), columns, state.sortKey, state.sortDir)

  const children = [
    {
      tag: 'callout',
      kind: 'tip',
      title: 'Vault tables',
      body: `Showing ${visible.length} of ${state.notes.length} notes. Click a column header to sort; click a row title to open the note.`,
    },
    row([
      {
        tag: 'input',
        type: 'search',
        value: state.filter || '',
        placeholder: 'filter by tag, status, anything...',
        onChange: { kind: 'emit', event: 'tables.filter' },
      },
      btn('Save current view as note', 'tables.save', { variant: 'primary' }),
      btn('Close', 'tables.close', { variant: 'ghost' }),
    ], 2),
  ]

  // Header row of buttons. Reusing list-of-list because the renderer
  // has no real table primitive — `box` of `box` rows is the
  // closest we can get with the curated VNode set, and it lays out
  // each row as a flex column. Wrapping every cell with a box
  // doesn't get us horizontal cells, so we render each row as a
  // wrapping `box` of inline children and rely on the renderer's
  // gap classes.

  const headerCells = [
    btn(headerLabel('_title', 'Title', state),       'tables.sort', { variant: 'ghost', payload: { key: '_title' } }),
    btn(headerLabel('_folder', 'Folder', state),     'tables.sort', { variant: 'ghost', payload: { key: '_folder' } }),
    ...columns.map((c) =>
      btn(headerLabel(c.key, c.key, state),          'tables.sort', { variant: 'ghost', payload: { key: c.key } }),
    ),
  ]
  children.push(row(headerCells, 2))

  // Data rows. Each row gets a `link` for the title (clickable —
  // intercepted by PR #142 wikilink dispatch) plus a `text` per
  // remaining column.
  for (const note of visible) {
    const cells = [
      {
        tag: 'link',
        label: note.title || '(untitled)',
        href: { kind: 'note', noteId: note.id },
      },
      txt(note.folderPath || ''),
      ...columns.map((c) => txt(valueToText(note.frontmatter ? note.frontmatter[c.key] : undefined))),
    ]
    children.push(row(cells, 2))
  }

  if (visible.length === 0) {
    children.push({
      tag: 'callout',
      kind: 'warn',
      title: 'No matches',
      body: 'No notes match the current filter. Clear the filter to see every note.',
    })
  }

  return { tag: 'box', gap: 3, children }
}

function headerLabel(key, base, state) {
  if (state.sortKey !== key) return base
  return state.sortDir === 'asc' ? `${base} ▲` : `${base} ▼`
}

// ─── Plugin state ───────────────────────────────────────────────────

const panelState = {
  // Cached snapshot of the active note + its host-parsed frontmatter.
  activeNote: null,            // { id, title, frontmatter }
  // Pending in-flight edits keyed by property key. Lets the input keep
  // the user's typed value visible until updateNote resolves.
  pendingEdits: {},
  // "+ Add property" row state.
  addOpen: false,
  draftKey: '',
  draftValue: '',
}

const tablesState = {
  // Fullscreen view state — captured + rendered when the modal mounts.
  open: false,
  notes: [],
  columns: [],
  filter: '',
  sortKey: '_title',
  sortDir: 'asc',
}

// ─── Wiring ─────────────────────────────────────────────────────────

/** Parse the user's edited string back into a frontmatter-compatible
 *  value, following the column's existing type. Falls back to string.
 *  Tag-array columns split on commas. */
function coerceEditedValue(prevValue, raw) {
  if (raw === undefined || raw === null) return ''
  const s = String(raw)
  if (Array.isArray(prevValue)) {
    return s.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
  }
  if (typeof prevValue === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : s
  }
  if (typeof prevValue === 'boolean') {
    if (s === 'true') return true
    if (s === 'false') return false
    return s
  }
  return s
}

async function refreshActiveNote(ctx) {
  const active = ctx.activeNote
  if (!active) {
    panelState.activeNote = null
    panelState.pendingEdits = {}
    panelState.addOpen = false
    ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
    return
  }
  try {
    const note = await ctx.vault.read.getNote(active.id)
    if (!note) {
      panelState.activeNote = null
    } else {
      panelState.activeNote = {
        id: note.id,
        title: note.title,
        frontmatter: note.frontmatter || {},
      }
    }
    panelState.pendingEdits = {}
  } catch (err) {
    ctx.notify(`Properties+: failed to read note — ${err && err.message ? err.message : String(err)}`)
    panelState.activeNote = null
  }
  ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
}

async function commitPropertyEdit(ctx, key, rawValue) {
  if (!panelState.activeNote) return
  const prev = panelState.activeNote.frontmatter[key]
  const next = coerceEditedValue(prev, rawValue)
  const fm = { ...panelState.activeNote.frontmatter, [key]: next }
  panelState.activeNote.frontmatter = fm
  try {
    await ctx.vault.write.updateNote(panelState.activeNote.id, { frontmatter: fm })
  } catch (err) {
    ctx.notify(`Properties+: save failed — ${err && err.message ? err.message : String(err)}`)
  }
  // Don't re-render after a single edit — the React-controlled input
  // already shows what the user typed, and a setPanelContent here would
  // rebuild the tree and reset the caret. Re-renders happen on
  // delete / add / cancel / active-note swap, which all change the
  // structure of the panel anyway.
}

async function commitPropertyDelete(ctx, key) {
  if (!panelState.activeNote) return
  const fm = { ...panelState.activeNote.frontmatter }
  delete fm[key]
  panelState.activeNote.frontmatter = fm
  try {
    await ctx.vault.write.updateNote(panelState.activeNote.id, { frontmatter: fm })
  } catch (err) {
    ctx.notify(`Properties+: delete failed — ${err && err.message ? err.message : String(err)}`)
  }
  ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
}

async function commitDraftAdd(ctx) {
  if (!panelState.activeNote) return
  const key = (panelState.draftKey || '').trim()
  if (key.length === 0) {
    ctx.notify('Properties+: provide a key before saving.')
    return
  }
  const value = coerceEditedValue('', panelState.draftValue || '')
  const fm = { ...panelState.activeNote.frontmatter, [key]: value }
  panelState.activeNote.frontmatter = fm
  panelState.addOpen = false
  panelState.draftKey = ''
  panelState.draftValue = ''
  try {
    await ctx.vault.write.updateNote(panelState.activeNote.id, { frontmatter: fm })
  } catch (err) {
    ctx.notify(`Properties+: add failed — ${err && err.message ? err.message : String(err)}`)
  }
  ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
}

async function loadTables(ctx) {
  try {
    const notes = await ctx.vault.read.getAllNotes()
    tablesState.notes = notes.slice()
    tablesState.columns = inferColumns(notes)
  } catch (err) {
    if (err && /use stream/i.test(String(err.message || err))) {
      // Fall back to streaming for large vaults.
      const collected = []
      try {
        for await (const chunk of ctx.vault.read.stream({ chunkSize: 200 })) {
          for (const n of chunk) collected.push(n)
        }
        tablesState.notes = collected
        tablesState.columns = inferColumns(collected)
      } catch (streamErr) {
        ctx.notify(
          `Vault tables: stream failed — ${streamErr && streamErr.message ? streamErr.message : String(streamErr)}`,
        )
        return
      }
    } else {
      ctx.notify(`Vault tables: getAllNotes failed — ${err && err.message ? err.message : String(err)}`)
      return
    }
  }
  ctx.setFullscreenContent('tables', renderTablesView(tablesState))
}

async function saveTableAsNote(ctx) {
  const visible = sortNotes(filterNotes(tablesState.notes, tablesState.filter), tablesState.columns, tablesState.sortKey, tablesState.sortDir)
  const md = tableToMarkdown(tablesState.columns, visible)
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const body =
    `# Vault tables snapshot\n\n` +
    `Generated ${stamp}. Filter: \`${tablesState.filter || '(none)'}\`. Sort: \`${tablesState.sortKey} ${tablesState.sortDir}\`.\n\n` +
    md + '\n'
  try {
    const result = await ctx.vault.write.createNote({
      title: `Vault tables ${stamp}`,
      body,
    })
    const suffix = result.conflictResolved === 'suffix' ? ' (host renamed to avoid a title collision)' : ''
    ctx.notify(`Saved table as note "${result.id}"${suffix}.`)
  } catch (err) {
    ctx.notify(`Save view failed — ${err && err.message ? err.message : String(err)}`)
  }
}

export default {
  id: 'noteser-properties',
  name: 'Properties+',
  version: '0.1.0',
  author: 'Noteser',
  description:
    "Sidebar editor for a note's frontmatter properties plus an Obsidian Bases-style vault-wide table view. Reads + writes notes via the v1.2 vault capabilities.",
  permissions: ['vault.read.all', 'vault.write', 'vault.events'],
  surfaces: {
    sidebarPanels: [{ id: 'properties-plus', title: 'Properties+' }],
    fullscreenViews: [{ id: 'tables', title: 'Vault tables' }],
    commands: [{ id: 'open-tables', title: 'Open Vault tables' }],
  },

  onActivate(ctx) {
    // Refresh the panel when the active note changes anywhere (sidebar
    // click, palette open, tab switch).
    ctx.vault.events.onActiveNoteChange(() => {
      void refreshActiveNote(ctx)
    })
    // When ANY note is saved we re-pull the active note so external
    // edits to the same frontmatter surface in the panel.
    ctx.vault.events.onNoteSaved((noteId) => {
      if (panelState.activeNote && panelState.activeNote.id === noteId) {
        void refreshActiveNote(ctx)
      }
      // If the tables modal is open, the in-memory snapshot is stale.
      // Re-derive columns + rows from the freshly-changed vault.
      if (tablesState.open) {
        void loadTables(ctx)
      }
    })

    // Wire every VNode event the host forwards from either surface.
    ctx.onVNodeEvent(({ event, payload, source }) => {
      // ─── Properties+ panel events ──────────────────────────────
      if (source.kind === 'panel' && source.panelId === 'properties-plus') {
        const p = (payload && typeof payload === 'object') ? payload : {}
        if (event === 'prop.edit') {
          void commitPropertyEdit(ctx, p.key, p.value)
          return
        }
        if (event === 'prop.delete') {
          void commitPropertyDelete(ctx, p.key)
          return
        }
        if (event === 'prop.add.open') {
          panelState.addOpen = true
          ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
          return
        }
        if (event === 'prop.draft.key') {
          panelState.draftKey = String(p.value || '')
          // Don't re-render on every keystroke — let the input keep its
          // local value and only re-render on save / cancel. Re-rendering
          // would discard the controlled-input cursor position.
          return
        }
        if (event === 'prop.draft.value') {
          panelState.draftValue = String(p.value || '')
          return
        }
        if (event === 'prop.draft.save') {
          void commitDraftAdd(ctx)
          return
        }
        if (event === 'prop.draft.cancel') {
          panelState.addOpen = false
          panelState.draftKey = ''
          panelState.draftValue = ''
          ctx.setPanelContent('properties-plus', renderPropertiesPanel(panelState))
          return
        }
      }

      // ─── Vault tables fullscreen events ────────────────────────
      if (source.kind === 'fullscreen' && source.viewId === 'tables') {
        const p = (payload && typeof payload === 'object') ? payload : {}
        if (event === 'tables.filter') {
          tablesState.filter = String(p.value || '')
          ctx.setFullscreenContent('tables', renderTablesView(tablesState))
          return
        }
        if (event === 'tables.sort') {
          const key = String(p.key || '')
          if (!key) return
          if (tablesState.sortKey === key) {
            tablesState.sortDir = tablesState.sortDir === 'asc' ? 'desc' : 'asc'
          } else {
            tablesState.sortKey = key
            tablesState.sortDir = 'asc'
          }
          ctx.setFullscreenContent('tables', renderTablesView(tablesState))
          return
        }
        if (event === 'tables.save') {
          void saveTableAsNote(ctx)
          return
        }
        if (event === 'tables.close') {
          ctx.closeFullscreen('tables')
          return
        }
      }
    })
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== 'properties-plus') return
    void refreshActiveNote(ctx)
  },

  onActiveNoteChange(_note, ctx) {
    // Mirror the vault.events.onActiveNoteChange wiring above — the
    // host fires both signals; either one is enough to drive the
    // panel. Keeping this handler too means the panel still works
    // when the user grants the panel surface but revokes vault.events.
    void refreshActiveNote(ctx)
  },

  async onCommand(commandId, ctx) {
    if (commandId !== 'open-tables') return
    try {
      await ctx.openFullscreen('tables')
    } catch (err) {
      ctx.notify(err && err.message ? err.message : 'Could not open Vault tables.')
    }
  },

  async onFullscreenMount(viewId, ctx) {
    if (viewId !== 'tables') return
    tablesState.open = true
    tablesState.filter = ''
    tablesState.sortKey = '_title'
    tablesState.sortDir = 'asc'
    await loadTables(ctx)
  },

  onFullscreenUnmount(viewId) {
    if (viewId !== 'tables') return
    tablesState.open = false
  },
}
