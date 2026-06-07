// noteser-importer v0.1.0
//
// Closes #73. Imports an Obsidian vault (folder of .md / .markdown), a
// Notion export (single .zip), or a Logseq export (folder of .md) into
// the active vault. Routes every conversion through the host's
// `ctx.vault.write.createNote`, so noteser's own conflict-suffix
// resolver (" (imported)") owns the rename policy.
//
// Wire shape — see `docs/plugins-v1.2-plan.md` §13:
//
//   1. Command "Import notes from..." opens a fullscreen view.
//   2. View has a radio picker (Obsidian / Notion / Logseq), a
//      "Choose source" button, and a progress / summary area.
//   3. Button click opens the matching native picker:
//        - Obsidian / Logseq → ctx.fs.openDirectory({ extensions: ['.md', '.markdown'] })
//        - Notion           → ctx.requestFileOpen({ accept: ['.zip'] })
//   4. The plugin then loops, sets fullscreen content to a progress
//      string ("Importing X of Y..."), and POSTs each note via
//      vault.write.createNote.
//   5. Counts get tallied:
//        - imported (every successful createNote)
//        - conflicts (host returned conflictResolved === 'suffix')
//        - lossy (Logseq block refs that downgraded to a blockquote)
//   6. Done. Summary view + "Close" button.
//
// Parser/transform functions live in ./parsers.js; the worker loads
// them via dynamic import at the published URL (same pattern as
// noteser-pdf-export uses for jsPDF).
//
// Self-contained ES module. The worker imports via Blob URL; named
// exports below are for the Jest test, which dynamic-imports the file
// directly.

// ─── Lazy dependency loaders ─────────────────────────────────────────
//
// Two heavy bits (fflate for unzipping, the parsers module itself)
// only load when the user actually picks a source. Keeps the plugin's
// startup boot cheap and avoids paying for code paths a user may never
// take in a session.

let parsersPromise = null
function loadParsers() {
  if (parsersPromise === null) {
    parsersPromise = import('/plugins/noteser-importer/parsers.js')
  }
  return parsersPromise
}

let fflatePromise = null
function loadFflate() {
  if (fflatePromise === null) {
    fflatePromise = import('/plugins/noteser-importer/fflate.module.js')
  }
  return fflatePromise
}

// ─── State ───────────────────────────────────────────────────────────
//
// The fullscreen view is a single page that goes through three phases:
// pick → progress → done. The plugin owns the phase machine; the host
// just renders whatever VNode tree we push via setFullscreenContent.

const STATE = {
  phase: 'pick', // 'pick' | 'progress' | 'done'
  format: 'obsidian', // 'obsidian' | 'notion' | 'logseq'
  progress: { current: 0, total: 0, label: '' },
  summary: { imported: 0, conflicts: 0, lossy: 0, errors: 0 },
}

function resetState() {
  STATE.phase = 'pick'
  STATE.format = 'obsidian'
  STATE.progress = { current: 0, total: 0, label: '' }
  STATE.summary = { imported: 0, conflicts: 0, lossy: 0, errors: 0 }
}

// ─── Voice-rule-compliant labels ─────────────────────────────────────
//
// Per Jon's rule: command label, radio labels, button labels — no em
// dashes, no contractions. Re-used everywhere so a future copy edit
// touches one place.

const COPY = {
  commandTitle: 'Import notes from...',
  viewTitle: 'Import notes',
  pickPrompt: 'Choose the source format you want to import from.',
  formatObsidian: 'Obsidian vault folder',
  formatNotion: 'Notion ZIP export',
  formatLogseq: 'Logseq export folder',
  chooseObsidian: 'Choose Obsidian folder',
  chooseNotion: 'Choose Notion ZIP file',
  chooseLogseq: 'Choose Logseq folder',
  closeButton: 'Close',
  cancelled: 'No source selected. Pick a folder or ZIP file to begin.',
  empty: 'The picked source contained no Markdown files.',
  summaryHeading: 'Import complete.',
}

function chooseLabel(format) {
  if (format === 'obsidian') return COPY.chooseObsidian
  if (format === 'notion') return COPY.chooseNotion
  return COPY.chooseLogseq
}

// ─── Render: the pick phase ──────────────────────────────────────────

function renderPick() {
  return {
    tag: 'box',
    gap: 4,
    children: [
      { tag: 'text', value: COPY.pickPrompt },
      {
        tag: 'radio',
        group: 'format',
        value: STATE.format,
        options: [
          { value: 'obsidian', label: COPY.formatObsidian },
          { value: 'notion', label: COPY.formatNotion },
          { value: 'logseq', label: COPY.formatLogseq },
        ],
        onChange: { kind: 'emit', event: 'importer.format' },
      },
      {
        tag: 'button',
        label: chooseLabel(STATE.format),
        variant: 'primary',
        onClick: { kind: 'emit', event: 'importer.choose' },
      },
    ],
  }
}

// ─── Render: the progress phase ──────────────────────────────────────

function renderProgress() {
  const { current, total, label } = STATE.progress
  // Build the recent-imports list as plain text items. The VNode list
  // shape is the cheapest "growing log" surface available; it scrolls
  // for free inside the fullscreen modal.
  const items = []
  if (label) {
    items.push({
      tag: 'text',
      value: `Importing ${current} of ${total}: ${label}`,
    })
  } else if (total === 0) {
    items.push({ tag: 'text', value: 'Reading source...' })
  } else {
    items.push({
      tag: 'text',
      value: `Importing ${current} of ${total}...`,
    })
  }

  return {
    tag: 'box',
    gap: 3,
    children: [
      {
        tag: 'callout',
        kind: 'info',
        title: COPY.viewTitle,
        body: 'Each note is created through the vault write capability. Do not close the view until the summary appears.',
      },
      { tag: 'list', ordered: false, items },
    ],
  }
}

// ─── Render: the done phase ──────────────────────────────────────────

function renderDone() {
  const { imported, conflicts, lossy, errors } = STATE.summary
  const lines = [
    { tag: 'text', value: `Imported: ${imported} note${imported === 1 ? '' : 's'}.` },
    {
      tag: 'text',
      value: `Conflicts auto-renamed (" (imported)" suffix): ${conflicts}.`,
    },
    {
      tag: 'text',
      value: `Lossy conversions (Logseq block refs flattened to blockquote): ${lossy}.`,
    },
  ]
  if (errors > 0) {
    lines.push({
      tag: 'text',
      value: `Failures: ${errors} (notes the host refused; see the developer console for details).`,
    })
  }

  return {
    tag: 'box',
    gap: 4,
    children: [
      {
        tag: 'callout',
        kind: 'tip',
        title: COPY.summaryHeading,
        body: 'Review the counts below. The notes are now available in the sidebar.',
      },
      { tag: 'list', ordered: false, items: lines },
      {
        tag: 'button',
        label: COPY.closeButton,
        variant: 'primary',
        onClick: { kind: 'emit', event: 'importer.close' },
      },
    ],
  }
}

function currentView() {
  if (STATE.phase === 'pick') return renderPick()
  if (STATE.phase === 'progress') return renderProgress()
  return renderDone()
}

function push(ctx) {
  ctx.setFullscreenContent('import', currentView())
}

// ─── Import drivers ──────────────────────────────────────────────────
//
// Each source format gets its own driver. All three converge on the
// same shape — a list of `{ title, body, folderPath?, lossy? }` records —
// then runImport posts each through vault.write.createNote.

async function driveObsidian(ctx) {
  const entries = await ctx.fs.openDirectory({ extensions: ['.md', '.markdown'] })
  if (entries === null) return null
  const parsers = await loadParsers()
  const records = []
  for (const entry of entries) {
    if (!parsers.hasMarkdownExtension(entry.name)) continue
    const text = await entry.blob.text()
    const record = parsers.parseObsidianEntry(entry.path, text)
    if (record) records.push(record)
  }
  return records
}

async function driveNotion(ctx) {
  const picked = await ctx.requestFileOpen({ accept: ['.zip', 'application/zip'] })
  if (picked === null) return null
  const [parsers, fflate] = await Promise.all([loadParsers(), loadFflate()])
  // fflate's unzipSync gives us a `{ [path]: Uint8Array }` map. The
  // Notion archive is typically only a few MB — we keep everything in
  // memory rather than streaming. If a Notion export ever exceeds the
  // worker heap, we revisit the streaming `unzip()` API at that point.
  const archive = fflate.unzipSync(picked.bytes)
  const decoder = new TextDecoder('utf-8')
  const records = []
  for (const path in archive) {
    if (!parsers.hasMarkdownExtension(path)) continue
    const text = decoder.decode(archive[path])
    const record = parsers.parseNotionEntry(path, text)
    if (record) records.push(record)
  }
  return records
}

async function driveLogseq(ctx) {
  const entries = await ctx.fs.openDirectory({ extensions: ['.md', '.markdown'] })
  if (entries === null) return null
  const parsers = await loadParsers()
  const records = []
  for (const entry of entries) {
    if (!parsers.hasMarkdownExtension(entry.name)) continue
    const text = await entry.blob.text()
    const record = parsers.parseLogseqEntry(entry.path, text)
    if (record) records.push(record)
  }
  return records
}

async function runImport(ctx, records) {
  STATE.phase = 'progress'
  STATE.progress = { current: 0, total: records.length, label: '' }
  push(ctx)

  // The host caps vault.write at ~60 ops/sec via its message rate
  // limiter. Posting tightly is fine because each createNote awaits
  // the host's reply before returning, naturally pacing the loop.
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    STATE.progress = {
      current: i + 1,
      total: records.length,
      label: r.title,
    }
    push(ctx)

    try {
      const result = await ctx.vault.write.createNote({
        title: r.title,
        body: r.body,
        ...(r.folderPath ? { folderPath: r.folderPath } : {}),
      })
      STATE.summary.imported++
      if (result.conflictResolved === 'suffix') STATE.summary.conflicts++
      if (r.lossy && r.lossy > 0) STATE.summary.lossy += r.lossy
    } catch (err) {
      STATE.summary.errors++
      // Surface the first few errors via the toast helper too — silent
      // failures inside a loop are the cardinal sin.
      if (STATE.summary.errors <= 3) {
        ctx.notify(
          `Import failed for "${r.title}": ${err && err.message ? err.message : String(err)}`,
        )
      }
    }
  }

  STATE.phase = 'done'
  push(ctx)
  ctx.notify(
    `Import complete. ${STATE.summary.imported} note${
      STATE.summary.imported === 1 ? '' : 's'
    } imported, ${STATE.summary.conflicts} renamed.`,
  )
}

// ─── The button-click handler ────────────────────────────────────────

async function handleChoose(ctx) {
  let records = null
  try {
    if (STATE.format === 'obsidian') records = await driveObsidian(ctx)
    else if (STATE.format === 'notion') records = await driveNotion(ctx)
    else records = await driveLogseq(ctx)
  } catch (err) {
    ctx.notify(
      `Import setup failed: ${err && err.message ? err.message : String(err)}`,
    )
    return
  }
  if (records === null) {
    ctx.notify(COPY.cancelled)
    return
  }
  if (records.length === 0) {
    ctx.notify(COPY.empty)
    return
  }
  await runImport(ctx, records)
}

// ─── Plugin definition ───────────────────────────────────────────────

export default {
  id: 'noteser-importer',
  name: 'Importer',
  version: '0.1.0',
  author: 'Noteser',
  description:
    "Import notes from an Obsidian vault folder, a Notion ZIP export, or a Logseq export folder. Wikilinks survive; conflicts auto-suffix; Logseq block refs degrade to a quoted note.",
  permissions: ['fs.open-directory', 'vault.write', 'file-open'],
  surfaces: {
    commands: [{ id: 'open-import', title: COPY.commandTitle }],
    fullscreenViews: [{ id: 'import', title: COPY.viewTitle }],
  },

  onActivate(ctx) {
    // ONE handler routes every event the fullscreen view fires back.
    // Stacking would create duplicate close / choose calls if the user
    // re-runs the command, so we only register here in onActivate.
    ctx.onVNodeEvent(({ event, payload, source }) => {
      if (source.kind !== 'fullscreen' || source.viewId !== 'import') return
      if (event === 'importer.format' && payload && typeof payload === 'object') {
        const next = String(payload.value ?? 'obsidian')
        if (next === 'obsidian' || next === 'notion' || next === 'logseq') {
          STATE.format = next
          push(ctx)
        }
        return
      }
      if (event === 'importer.choose') {
        // Fire-and-forget — the handler chain itself is sync from the
        // host's perspective, but the actual import is async and long-
        // running. Errors surface via the toast in handleChoose.
        void handleChoose(ctx)
        return
      }
      if (event === 'importer.close') {
        ctx.closeFullscreen('import')
        return
      }
    })
  },

  async onCommand(commandId, ctx) {
    if (commandId !== 'open-import') return
    resetState()
    try {
      await ctx.openFullscreen('import')
    } catch (err) {
      ctx.notify(
        err instanceof Error ? err.message : 'Could not open the Import view.',
      )
    }
  },

  onFullscreenMount(viewId, ctx) {
    if (viewId !== 'import') return
    push(ctx)
  },

  onFullscreenUnmount() {
    // No persistent state across mounts — every command invocation
    // resets via resetState in onCommand.
  },
}

// ─── Named test exports ──────────────────────────────────────────────
//
// The Jest tests dynamic-import this module by absolute path and use
// these to exercise the render and import drivers in isolation. The
// worker entry path (default export) never reaches for them.

export {
  STATE as __TEST_STATE,
  resetState as __testResetState,
  renderPick as __testRenderPick,
  renderProgress as __testRenderProgress,
  renderDone as __testRenderDone,
  currentView as __testCurrentView,
  runImport as __testRunImport,
}
