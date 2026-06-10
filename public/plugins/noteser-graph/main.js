// noteser-graph v0.2.0
//
// Closes issue #71. Built on Plugin API v1.2 (PRs A, B, C, F + the
// VNode event delivery follow-up).
//
// Provides two surfaces:
//
//   1. A sidebar panel "Graph" for the ACTIVE note. Shows backlinks
//      and unlinked mentions plus a button that opens the global
//      graph in a fullscreen view.
//
//   2. A fullscreen view "Graph" containing a force-directed SVG of
//      the vault. v0.2.0 (the "G1: graph richness" increment) adds,
//      all on the existing v1.2 VNode surface and with no platform
//      change:
//        - Local graph: a per-active-note neighbourhood at depth
//          1 / 2 / 3 (BFS over the derived edge set).
//        - Color groups: color every node by folder, by tag, or by a
//          highlight query.
//        - Filters: a search box that dims non-matching nodes, a
//          "hide orphans" toggle, and a "tags as nodes" toggle.
//        - Force tuning: center force, repel strength, link force,
//          link distance, and a node size multiplier, each a number
//          input with a reset-to-defaults button.
//        - Node sizing by degree (size multiplier exposed above).
//        - Tags as nodes (off by default, gated behind the filter
//          toggle): one synthetic node per distinct tag with an edge
//          from each note to its tags.
//      Every user choice persists via setSetting under the "g1."
//      namespace so it survives a reload.
//
// Permissions: vault.read.all, vault.events.
//
// Self-contained ES module. The worker dynamic-imports via Blob URL,
// so the file cannot rely on sibling imports - every pure helper is
// inline and exported by name so the Jest suite can unit-test it.

// ------------------------- Pure helpers (exported) -------------------------
//
// These are exported by name so the Jest test suite can import the
// plugin module and verify the derivation logic. Runtime callers
// (the plugin's own handlers) reach them through the closure.

// Same wikilink shape the core scanner uses. We only look at the
// pre-pipe portion (the "real" target), not the alias / display.
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

/** Pull every wikilink target out of a body, lowercased + trimmed. */
export function extractWikilinks(body) {
  if (!body || body.indexOf('[[') === -1) return []
  const out = []
  WIKILINK_RE.lastIndex = 0
  let m
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const q = (m[1] ?? '').trim().toLowerCase()
    if (q) out.push(q)
  }
  return out
}

/**
 * Build the masked body: replace every fenced code block, inline
 * code span, and existing wikilink with same-length runs of spaces.
 * Same-length means character offsets line up with the original
 * body, so callers can still report line numbers if needed.
 *
 * Order matters: code blocks first (multi-line, greedy on the
 * delimiters), then wikilinks (single-line, non-greedy), then
 * inline code. Inline code can sit inside a paragraph that also
 * contains a wikilink, so wikilinks land first to avoid masking a
 * `[[` inside an inline-code span (which already got masked).
 */
export function maskCodeAndWikilinks(body) {
  if (!body) return ''
  let out = body
  // Fenced code blocks: ```lang? ... ```
  out = out.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
  // Wikilinks: [[Target]] or [[Target|Display]]
  out = out.replace(/\[\[[^\]\n]+?\]\]/g, (m) => ' '.repeat(m.length))
  // Inline code: `code` (greedy across single ticks, non-greedy
  // across newlines so it stays on one line).
  out = out.replace(/`[^`\n]+?`/g, (m) => ' '.repeat(m.length))
  return out
}

/**
 * Escape a string for embedding inside a RegExp. Standard form.
 */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Tag pattern mirrors src/utils/tags.ts: starts with `#`, follows a
// non-tag char or line start, body of [A-Za-z0-9_/-] (so nested tags
// like #work/q1 survive), not followed by another tag char. Code
// blocks and inline code are masked out first so a `#tag` inside code
// is not counted.
const TAG_RE = /(^|[^\w#/-])(#[A-Za-z0-9_/-]+)(?![\w/-])/g

/**
 * Extract every distinct tag (leading `#` stripped) from a body,
 * lowercased. Code blocks and inline code are masked first so tags
 * inside code do not count. Reimplemented inline because the worker
 * has no access to `@/utils/tags`.
 */
export function extractTagsInline(body) {
  if (!body || body.indexOf('#') === -1) return []
  const masked = maskCodeAndWikilinks(body)
  const out = []
  const seen = new Set()
  TAG_RE.lastIndex = 0
  let m
  while ((m = TAG_RE.exec(masked)) !== null) {
    const name = m[2].slice(1).toLowerCase()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * Find unlinked mentions of `title` in `body`.
 *
 *  - title is matched case-insensitively, as a whole word.
 *  - existing `[[wikilinks]]`, fenced code blocks, and inline code
 *    are masked out before matching.
 *  - returns { count, snippet }, or null when `title` is empty.
 */
export function findUnlinkedMentions(body, title) {
  const t = (title ?? '').trim()
  if (!t) return null
  const masked = maskCodeAndWikilinks(body ?? '')
  if (!masked) return { count: 0, snippet: null }
  const re = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(t)})(?=$|[^A-Za-z0-9_])`, 'gi')
  let count = 0
  let snippet = null
  let m
  while ((m = re.exec(masked)) !== null) {
    count++
    if (snippet === null) {
      const matchStart = m.index + m[1].length
      const sliceStart = Math.max(0, matchStart - 50)
      const sliceEnd = Math.min(body.length, matchStart + t.length + 50)
      let text = body.slice(sliceStart, sliceEnd)
      if (sliceStart > 0) text = '...' + text
      if (sliceEnd < body.length) text = text + '...'
      snippet = text.replace(/\s+/g, ' ').trim()
    }
  }
  return { count, snippet }
}

/**
 * Derive the link graph from a vault snapshot.
 *
 * Input:  notes - array of { id, title, body } (extra fields ok).
 * Output: { nodes, edges }
 *           nodes: [{ id, title, degree, kind: 'note' }]
 *           edges: [{ source, target }]
 *
 *  - Edges are de-duplicated; self-links dropped.
 *  - Unresolved targets dropped silently.
 *  - Case-insensitive title resolution; duplicate titles map to the
 *    first note that owns them (stable by input order).
 */
export function deriveGraph(notes) {
  const titleToId = new Map()
  for (const n of notes) {
    const t = (n.title ?? '').trim().toLowerCase()
    if (!t) continue
    if (!titleToId.has(t)) titleToId.set(t, n.id)
  }
  const edgeKeys = new Set()
  const edges = []
  const degree = new Map()
  for (const n of notes) {
    const links = extractWikilinks(n.body ?? '')
    for (const q of links) {
      const targetId = titleToId.get(q)
      if (!targetId) continue
      if (targetId === n.id) continue
      const key = n.id + ' ' + targetId
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ source: n.id, target: targetId })
      degree.set(n.id, (degree.get(n.id) ?? 0) + 1)
      degree.set(targetId, (degree.get(targetId) ?? 0) + 1)
    }
  }
  const nodes = notes.map((n) => ({
    id: n.id,
    title: (n.title ?? '').trim() || '(untitled)',
    degree: degree.get(n.id) ?? 0,
    kind: 'note',
  }))
  return { nodes, edges }
}

// Prefix that namespaces a synthetic tag node id away from real note
// ids (which are UUIDs and never contain this sequence).
export const TAG_NODE_PREFIX = 'graph-tag::'

/** Build the id used for a tag node from a lowercased tag name. */
export function tagNodeId(name) {
  return TAG_NODE_PREFIX + name
}

/**
 * Recompute the in+out degree for every node from an edge list and
 * return a fresh node array with the updated `degree`. Pure: inputs
 * are not mutated.
 */
export function recomputeDegree(nodes, edges) {
  const degree = new Map()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  return nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
}

/**
 * Add one synthetic node per distinct tag and an edge from each note
 * to every tag it carries, on top of an already-derived base graph.
 *
 *   base  - { nodes, edges } from deriveGraph
 *   notes - the same vault snapshot (need bodies for tag extraction)
 *
 * Returns a new { nodes, edges } with tag nodes (`kind: 'tag'`)
 * appended and every degree recomputed. Does not mutate `base`.
 */
export function deriveTagGraph(base, notes) {
  const nodes = base.nodes.map((n) => ({ ...n }))
  const edges = base.edges.map((e) => ({ ...e }))
  const tagNodes = new Map() // tagNodeId -> node
  const edgeKeys = new Set(edges.map((e) => e.source + ' ' + e.target))
  for (const n of notes) {
    const tags = extractTagsInline(n.body ?? '')
    for (const name of tags) {
      const id = tagNodeId(name)
      if (!tagNodes.has(id)) {
        tagNodes.set(id, { id, title: '#' + name, degree: 0, kind: 'tag' })
      }
      const key = n.id + ' ' + id
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ source: n.id, target: id })
    }
  }
  for (const node of tagNodes.values()) nodes.push(node)
  return { nodes: recomputeDegree(nodes, edges), edges }
}

/**
 * Breadth-first neighbourhood of `rootId` over an UNDIRECTED reading
 * of the edge list, out to `depth` hops (inclusive of the root).
 * Returns a Set of node ids. O(nodes + edges) - cheap for a
 * 500-note vault even at depth 3.
 */
export function bfsNeighbourhood(edges, rootId, depth) {
  const reached = new Set()
  if (!rootId) return reached
  reached.add(rootId)
  if (depth <= 0) return reached
  // Build an undirected adjacency list once.
  const adj = new Map()
  const push = (a, b) => {
    let list = adj.get(a)
    if (!list) {
      list = []
      adj.set(a, list)
    }
    list.push(b)
  }
  for (const e of edges) {
    push(e.source, e.target)
    push(e.target, e.source)
  }
  let frontier = [rootId]
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = []
    for (const id of frontier) {
      const neighbours = adj.get(id)
      if (!neighbours) continue
      for (const nb of neighbours) {
        if (reached.has(nb)) continue
        reached.add(nb)
        next.push(nb)
      }
    }
    frontier = next
  }
  return reached
}

/**
 * Restrict a graph to the nodes in `idSet`, dropping any edge with an
 * endpoint outside the set, then recompute degree. Pure.
 */
export function subgraphForIds(graph, idSet) {
  const nodes = graph.nodes.filter((n) => idSet.has(n.id))
  const edges = graph.edges.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target),
  )
  return { nodes: recomputeDegree(nodes, edges), edges }
}

/**
 * Local graph: the neighbourhood of `rootId` out to `depth` hops.
 * When `rootId` is missing from the graph the result is just that
 * single root node (if present) with no edges.
 */
export function localGraph(graph, rootId, depth) {
  const idSet = bfsNeighbourhood(graph.edges, rootId, depth)
  return subgraphForIds(graph, idSet)
}

/**
 * Drop every degree-0 node (orphan) before layout. Degree is
 * recomputed from the current edge list first so callers do not have
 * to keep it in sync. Edges are unchanged (orphans own none). Pure.
 */
export function dropOrphans(graph) {
  const withDegree = recomputeDegree(graph.nodes, graph.edges)
  const nodes = withDegree.filter((n) => n.degree > 0)
  return { nodes, edges: graph.edges }
}

/** Case-insensitive substring match across a note's title + body. */
export function noteMatchesQuery(note, query) {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return false
  const hay = ((note?.title ?? '') + ' ' + (note?.body ?? '')).toLowerCase()
  return hay.includes(q)
}

// Color palette + group colors. Hex strings only so the host's
// safeColor validator accepts them.
const COLOR_PALETTE = [
  '#8b5cf6',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#a855f7',
  '#84cc16',
  '#06b6d4',
  '#eab308',
]
export const DEFAULT_NODE_COLOR = '#8b5cf6'
export const TAG_NODE_COLOR = '#f59e0b'
export const QUERY_HIT_COLOR = '#10b981'
export const DIM_COLOR = '#3a4256'

/** Deterministic palette pick for a grouping key (folder path, tag). */
export function colorForKey(key) {
  const s = String(key ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return COLOR_PALETTE[h % COLOR_PALETTE.length]
}

/**
 * Compute a fill color per node.
 *
 *   nodes     - [{ id, title, kind }]
 *   notesById - Map(id -> { title, body, folderPath })
 *   opts      - { colorBy, colorQuery, search }
 *
 *  - When `search` is non-empty, any node whose title/body does not
 *    match is dimmed to DIM_COLOR (this is the filter dim; matching
 *    nodes still take their group color).
 *  - Tag nodes always take TAG_NODE_COLOR (unless dimmed by search).
 *  - colorBy 'folder' | 'tag' | 'query' assign group colors; 'none'
 *    leaves the default node color.
 *
 * Returns a Map(id -> color hex). Pure relative to its inputs.
 */
export function computeNodeColors(nodes, notesById, opts) {
  const colorBy = opts?.colorBy ?? 'none'
  const colorQuery = (opts?.colorQuery ?? '').trim()
  const search = (opts?.search ?? '').trim().toLowerCase()
  const map = new Map()
  for (const n of nodes) {
    const isTag = n.kind === 'tag'
    const note = isTag ? null : notesById.get(n.id)
    if (search) {
      const hay = isTag
        ? (n.title ?? '').toLowerCase()
        : ((note?.title ?? n.title ?? '') + ' ' + (note?.body ?? '')).toLowerCase()
      if (!hay.includes(search)) {
        map.set(n.id, DIM_COLOR)
        continue
      }
    }
    if (isTag) {
      map.set(n.id, TAG_NODE_COLOR)
      continue
    }
    let color = DEFAULT_NODE_COLOR
    if (colorBy === 'folder') {
      const f = (note?.folderPath ?? '').trim()
      color = f ? colorForKey('folder:' + f) : DEFAULT_NODE_COLOR
    } else if (colorBy === 'tag') {
      const tags = note ? extractTagsInline(note.body ?? '') : []
      color = tags.length ? colorForKey('tag:' + tags[0]) : DEFAULT_NODE_COLOR
    } else if (colorBy === 'query') {
      color = colorQuery && note && noteMatchesQuery(note, colorQuery)
        ? QUERY_HIT_COLOR
        : DEFAULT_NODE_COLOR
    }
    map.set(n.id, color)
  }
  return map
}

/**
 * Find every linker to a given note. Used for the sidebar
 * "Backlinks" section. Returns [{ id, title }, ...].
 */
export function findBacklinks(notes, targetId, targetTitle) {
  const t = (targetTitle ?? '').trim().toLowerCase()
  if (!t) return []
  const out = []
  const seen = new Set()
  for (const n of notes) {
    if (n.id === targetId) continue
    const links = extractWikilinks(n.body ?? '')
    if (!links.includes(t)) continue
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push({ id: n.id, title: (n.title ?? '').trim() || '(untitled)' })
  }
  return out
}

/**
 * Find every note (excluding the target itself and existing
 * backlinkers) that contains the target title as an unlinked
 * mention. Returns [{ id, title, count, snippet }, ...].
 */
export function findUnlinkedMentionsAcross(notes, targetId, targetTitle) {
  const t = (targetTitle ?? '').trim()
  if (!t) return []
  const backlinkerIds = new Set(
    findBacklinks(notes, targetId, t).map((b) => b.id),
  )
  const out = []
  for (const n of notes) {
    if (n.id === targetId) continue
    if (backlinkerIds.has(n.id)) continue
    const r = findUnlinkedMentions(n.body ?? '', t)
    if (!r || r.count === 0) continue
    out.push({
      id: n.id,
      title: (n.title ?? '').trim() || '(untitled)',
      count: r.count,
      snippet: r.snippet,
    })
  }
  return out
}

/**
 * FNV-1a 32-bit rolling hash over (id, updatedAt) pairs. Cheap
 * snapshot identity for the getAllNotes cache. Not cryptographic.
 */
export function snapshotSha(notes) {
  let h = 0x811c9dc5
  for (const n of notes) {
    const s = String(n.id) + ':' + String(n.updatedAt ?? 0)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h.toString(16)
}

// --------------------------- Force layout ------------------------------
//
// Hand-rolled O(n^2) force simulator. Good enough for 1k nodes in
// well under the 500ms budget. No Barnes-Hut, no quadtree - just
// paired repulsion + spring attraction + center pull, with a step
// decay. The four force constants are tunable per call via
// `opts.forces`; defaults reproduce the original v0.1.0 layout.

const LAYOUT_WIDTH = 1024
const LAYOUT_HEIGHT = 768
const LAYOUT_DAMPING = 0.85
const LAYOUT_MAX_SPEED = 18

/** Default force constants. These are the v0.1.0 hard-coded values. */
export const DEFAULT_FORCES = {
  center: 0.005, // pull toward (cx, cy)
  repel: 600, // node-node repulsion strength
  linkForce: 0.04, // edge spring constant
  linkDistance: 60, // edge target length
  sizeMultiplier: 1, // node radius scale (render-only)
}

/** Clamp user-entered force values to sane ranges so a stray 0 / NaN
 *  / huge number cannot blow up the simulation or the SVG. */
export function clampForces(forces) {
  const f = { ...DEFAULT_FORCES, ...(forces || {}) }
  const num = (v, def) => (Number.isFinite(v) ? v : def)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  return {
    center: clamp(num(f.center, DEFAULT_FORCES.center), 0, 0.2),
    repel: clamp(num(f.repel, DEFAULT_FORCES.repel), 0, 5000),
    linkForce: clamp(num(f.linkForce, DEFAULT_FORCES.linkForce), 0, 1),
    linkDistance: clamp(num(f.linkDistance, DEFAULT_FORCES.linkDistance), 1, 500),
    sizeMultiplier: clamp(num(f.sizeMultiplier, DEFAULT_FORCES.sizeMultiplier), 0.25, 5),
  }
}

/**
 * Scale iterations down for large graphs so the open-graph budget
 * (<500 ms for 1 k nodes) stays in reach.
 */
function defaultIterations(n) {
  if (n <= 100) return 220
  if (n <= 250) return 140
  if (n <= 500) return 80
  if (n <= 1000) return 40
  return 25
}

export function runForceSimulation(nodes, edges, opts) {
  const width = opts?.width ?? LAYOUT_WIDTH
  const height = opts?.height ?? LAYOUT_HEIGHT
  const iterations = opts?.iterations ?? defaultIterations(nodes.length)
  const forces = clampForces(opts?.forces)
  const repulsion = forces.repel
  const springK = forces.linkForce
  const springRest = forces.linkDistance
  const centerK = forces.center
  const cx = width / 2
  const cy = height / 2

  // Mulberry32 seeded PRNG so the layout is reproducible per call.
  const seed = makeSeed(nodes)
  const rand = mulberry32(seed)

  const N = nodes.length
  const radius = Math.min(width, height) * 0.4
  const sim = nodes.map((n, i) => {
    const angle = (i / Math.max(1, N)) * Math.PI * 2
    return {
      id: n.id,
      x: cx + Math.cos(angle) * radius + (rand() - 0.5) * 20,
      y: cy + Math.sin(angle) * radius + (rand() - 0.5) * 20,
      vx: 0,
      vy: 0,
    }
  })
  const indexById = new Map(sim.map((s, i) => [s.id, i]))

  for (let step = 0; step < iterations; step++) {
    // Pair repulsion (O(n^2)).
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = sim[i]
        const b = sim[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = (rand() - 0.5) * 0.5
          dy = (rand() - 0.5) * 0.5
          d2 = dx * dx + dy * dy + 0.01
        }
        const d = Math.sqrt(d2)
        const f = repulsion / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // Spring attraction along edges.
    for (const e of edges) {
      const ai = indexById.get(e.source)
      const bi = indexById.get(e.target)
      if (ai === undefined || bi === undefined) continue
      const a = sim[ai]
      const b = sim[bi]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const delta = d - springRest
      const fx = (dx / d) * delta * springK
      const fy = (dy / d) * delta * springK
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Center pull + damping + integration.
    for (let i = 0; i < N; i++) {
      const p = sim[i]
      p.vx += (cx - p.x) * centerK
      p.vy += (cy - p.y) * centerK
      p.vx *= LAYOUT_DAMPING
      p.vy *= LAYOUT_DAMPING
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      if (sp > LAYOUT_MAX_SPEED) {
        p.vx = (p.vx / sp) * LAYOUT_MAX_SPEED
        p.vy = (p.vy / sp) * LAYOUT_MAX_SPEED
      }
      p.x += p.vx
      p.y += p.vy
    }
  }

  // Clamp to canvas (allow a small margin).
  const margin = 16
  for (const p of sim) {
    if (p.x < margin) p.x = margin
    if (p.x > width - margin) p.x = width - margin
    if (p.y < margin) p.y = margin
    if (p.y > height - margin) p.y = height - margin
  }
  return sim.map((p) => ({ id: p.id, x: p.x, y: p.y }))
}

function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeSeed(nodes) {
  let h = 0x811c9dc5
  for (const n of nodes) {
    const s = String(n.id)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h >>> 0
}

// ------------------------ Plugin runtime --------------------------------

const PANEL_ID = 'graph'
const VIEW_ID = 'graph'

// Setting keys, namespaced under "g1." so a future increment can pick
// its own namespace without clashing.
const SETTING_KEYS = {
  mode: 'g1.mode',
  depth: 'g1.depth',
  colorBy: 'g1.colorBy',
  colorQuery: 'g1.colorQuery',
  search: 'g1.search',
  hideOrphans: 'g1.hideOrphans',
  tagsAsNodes: 'g1.tagsAsNodes',
  forces: 'g1.forces',
}

// State the runtime keeps across handler firings.
const state = {
  ctx: null,
  notes: null,
  sha: null,
  activeNoteId: null,
  layout: null, // { nodes, edges, positions, notesById }
  fullscreenMounted: false,
  viewport: { x: 0, y: 0, scale: 1 },
  pickedNodeId: null,

  // G1 graph-richness controls. Loaded from settings on activate.
  mode: 'global', // 'global' | 'local'
  depth: 1, // 1 | 2 | 3
  colorBy: 'none', // 'none' | 'folder' | 'tag' | 'query'
  colorQuery: '',
  search: '',
  hideOrphans: false,
  tagsAsNodes: false,
  forces: { ...DEFAULT_FORCES },
}

/** Read persisted G1 settings into `state`. getSetting is synchronous
 *  (the host pre-populates the settings map before onActivate). */
function loadSettings(ctx) {
  try {
    const mode = ctx.getSetting(SETTING_KEYS.mode)
    if (mode === 'global' || mode === 'local') state.mode = mode

    const depth = Number(ctx.getSetting(SETTING_KEYS.depth))
    if (depth === 1 || depth === 2 || depth === 3) state.depth = depth

    const colorBy = ctx.getSetting(SETTING_KEYS.colorBy)
    if (['none', 'folder', 'tag', 'query'].includes(colorBy)) state.colorBy = colorBy

    const colorQuery = ctx.getSetting(SETTING_KEYS.colorQuery)
    if (typeof colorQuery === 'string') state.colorQuery = colorQuery

    const search = ctx.getSetting(SETTING_KEYS.search)
    if (typeof search === 'string') state.search = search

    state.hideOrphans = ctx.getSetting(SETTING_KEYS.hideOrphans) === true
    state.tagsAsNodes = ctx.getSetting(SETTING_KEYS.tagsAsNodes) === true

    const forces = ctx.getSetting(SETTING_KEYS.forces)
    if (forces && typeof forces === 'object') {
      state.forces = clampForces(forces)
    }
  } catch {
    // Settings unavailable - keep defaults.
  }
}

function persist(ctx, key, value) {
  try {
    ctx.setSetting(key, value)
  } catch {
    // Persisting is best-effort; an unavailable store must not break
    // the interaction.
  }
}

/** Lazily load + cache the vault snapshot. */
async function loadNotesSnapshot(ctx) {
  let notes
  try {
    notes = await ctx.vault.read.getAllNotes()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/Vault too large/i.test(msg)) {
      const acc = []
      for await (const chunk of ctx.vault.read.stream({ chunkSize: 200 })) {
        acc.push(...chunk)
      }
      notes = acc
    } else {
      throw err
    }
  }
  const sha = snapshotSha(notes)
  if (state.sha === sha && state.notes) return state.notes
  state.sha = sha
  state.notes = notes
  state.layout = null
  return notes
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()
}

function resolveActiveNoteId(ctx) {
  return state.activeNoteId ?? ctx.activeNote?.id ?? null
}

/** Render the sidebar panel for the active note. */
async function renderPanel(ctx) {
  const activeId = resolveActiveNoteId(ctx)
  if (!activeId) {
    ctx.setPanelContent(PANEL_ID, {
      tag: 'box',
      gap: 3,
      children: [
        { tag: 'text', value: 'Graph' },
        {
          tag: 'callout',
          kind: 'info',
          title: 'No active note',
          body: 'Open a note to see its backlinks and unlinked mentions.',
        },
        {
          tag: 'button',
          label: 'Open global graph',
          variant: 'primary',
          onClick: { kind: 'emit', event: 'graph.open' },
        },
      ],
    })
    return
  }

  const t0 = nowMs()
  const notes = await loadNotesSnapshot(ctx)
  const active = notes.find((n) => n.id === activeId)
  const activeTitle = (active?.title ?? '').trim()

  if (!activeTitle) {
    ctx.setPanelContent(PANEL_ID, {
      tag: 'box',
      gap: 3,
      children: [
        { tag: 'text', value: 'Graph' },
        {
          tag: 'callout',
          kind: 'info',
          title: 'Untitled note',
          body: 'Give this note a title to see backlinks and unlinked mentions.',
        },
        {
          tag: 'button',
          label: 'Open global graph',
          variant: 'primary',
          onClick: { kind: 'emit', event: 'graph.open' },
        },
      ],
    })
    return
  }

  const backlinks = findBacklinks(notes, activeId, activeTitle)
  const mentions = findUnlinkedMentionsAcross(notes, activeId, activeTitle)
  const t1 = nowMs()

  // eslint-disable-next-line no-console
  console.log(
    `[noteser-graph] panel derive: ${(t1 - t0).toFixed(1)} ms, ` +
      `${notes.length} notes, ${backlinks.length} backlinks, ${mentions.length} mentions`,
  )

  const backlinkItems = backlinks.length
    ? backlinks.map((b) => ({
        tag: 'link',
        label: b.title,
        href: { kind: 'note', noteId: b.id },
      }))
    : [{ tag: 'text', value: 'No backlinks to this note yet.' }]

  const mentionItems = mentions.length
    ? mentions.map((m) => ({
        tag: 'list',
        ordered: false,
        items: [
          {
            tag: 'link',
            label: `${m.title} (${m.count})`,
            href: { kind: 'note', noteId: m.id },
          },
          ...(m.snippet ? [{ tag: 'text', value: m.snippet }] : []),
        ],
      }))
    : [{ tag: 'text', value: 'No unlinked mentions.' }]

  ctx.setPanelContent(PANEL_ID, {
    tag: 'box',
    gap: 3,
    children: [
      { tag: 'text', value: `Linking to: ${activeTitle}` },
      { tag: 'text', value: 'Backlinks' },
      { tag: 'list', ordered: false, items: backlinkItems },
      { tag: 'text', value: 'Unlinked mentions' },
      { tag: 'box', gap: 2, children: mentionItems },
      {
        tag: 'button',
        label: 'Open global graph',
        variant: 'primary',
        onClick: { kind: 'emit', event: 'graph.open' },
      },
    ],
  })
}

/** Build the control panel shown above the SVG in the fullscreen view. */
function buildControls() {
  const children = []

  // View: global vs local neighbourhood of the active note.
  children.push({ tag: 'text', value: 'View' })
  children.push({
    tag: 'radio',
    group: 'graph-mode',
    value: state.mode,
    options: [
      { value: 'global', label: 'Global graph' },
      { value: 'local', label: 'Local graph (active note)' },
    ],
    onChange: { kind: 'emit', event: 'graph.setMode' },
  })
  if (state.mode === 'local') {
    children.push({ tag: 'text', value: 'Depth' })
    children.push({
      tag: 'radio',
      group: 'graph-depth',
      value: String(state.depth),
      options: [
        { value: '1', label: '1 hop' },
        { value: '2', label: '2 hops' },
        { value: '3', label: '3 hops' },
      ],
      onChange: { kind: 'emit', event: 'graph.setDepth' },
    })
  }

  // Color groups.
  children.push({ tag: 'text', value: 'Color groups' })
  children.push({
    tag: 'radio',
    group: 'graph-colorby',
    value: state.colorBy,
    options: [
      { value: 'none', label: 'None' },
      { value: 'folder', label: 'By folder' },
      { value: 'tag', label: 'By tag' },
      { value: 'query', label: 'By query' },
    ],
    onChange: { kind: 'emit', event: 'graph.setColorBy' },
  })
  if (state.colorBy === 'query') {
    children.push({
      tag: 'input',
      type: 'search',
      value: state.colorQuery,
      placeholder: 'Highlight notes matching...',
      onChange: { kind: 'emit', event: 'graph.setColorQuery' },
    })
  }

  // Filters.
  children.push({ tag: 'text', value: 'Filters' })
  children.push({
    tag: 'input',
    type: 'search',
    value: state.search,
    placeholder: 'Dim notes that do not match...',
    onChange: { kind: 'emit', event: 'graph.setSearch' },
  })
  children.push({
    tag: 'button',
    label: state.hideOrphans ? 'Show orphans' : 'Hide orphans',
    variant: state.hideOrphans ? 'primary' : 'default',
    onClick: { kind: 'emit', event: 'graph.toggleOrphans' },
  })
  children.push({
    tag: 'button',
    label: state.tagsAsNodes ? 'Hide tag nodes' : 'Show tags as nodes',
    variant: state.tagsAsNodes ? 'primary' : 'default',
    onClick: { kind: 'emit', event: 'graph.toggleTags' },
  })

  // Force tuning.
  children.push({ tag: 'text', value: 'Forces' })
  const forceRow = (label, key) => [
    { tag: 'text', value: label },
    {
      tag: 'input',
      type: 'number',
      value: state.forces[key],
      onChange: { kind: 'emit', event: 'graph.setForce', payload: { key } },
    },
  ]
  children.push(...forceRow('Center force', 'center'))
  children.push(...forceRow('Repel strength', 'repel'))
  children.push(...forceRow('Link force', 'linkForce'))
  children.push(...forceRow('Link distance', 'linkDistance'))
  children.push(...forceRow('Node size', 'sizeMultiplier'))
  children.push({
    tag: 'button',
    label: 'Reset forces',
    variant: 'ghost',
    onClick: { kind: 'emit', event: 'graph.resetForces' },
  })

  return { tag: 'box', gap: 2, children }
}

/** Build the fullscreen SVG VNode from the cached layout. */
function renderFullscreen(ctx) {
  if (!state.layout) {
    ctx.setFullscreenContent(VIEW_ID, {
      tag: 'box',
      gap: 3,
      children: [
        {
          tag: 'callout',
          kind: 'info',
          title: 'Computing layout',
          body: 'Loading the vault and running the force simulation. This usually takes well under a second.',
        },
      ],
    })
    return
  }
  const { nodes, edges, positions, notesById } = state.layout
  const posById = new Map(positions.map((p) => [p.id, p]))
  const colors = computeNodeColors(nodes, notesById, {
    colorBy: state.colorBy,
    colorQuery: state.colorQuery,
    search: state.search,
  })
  const sizeMult = clampForces(state.forces).sizeMultiplier

  const vw = Math.max(64, Math.round(LAYOUT_WIDTH * state.viewport.scale))
  const vh = Math.max(64, Math.round(LAYOUT_HEIGHT * state.viewport.scale))
  const vx = Math.round(state.viewport.x)
  const vy = Math.round(state.viewport.y)

  const lineNodes = []
  for (const e of edges) {
    const a = posById.get(e.source)
    const b = posById.get(e.target)
    if (!a || !b) continue
    lineNodes.push({
      tag: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: '#475569',
      strokeWidth: 1,
    })
  }
  const circleNodes = []
  for (const n of nodes) {
    const p = posById.get(n.id)
    if (!p) continue
    const r = Math.max(1, (4 + Math.min(8, n.degree)) * sizeMult)
    circleNodes.push({
      tag: 'circle',
      cx: p.x,
      cy: p.y,
      r,
      fill: colors.get(n.id) ?? DEFAULT_NODE_COLOR,
      stroke: '#0f172a',
      onClick: { kind: 'emit', event: 'graph.pickNode', payload: { id: n.id } },
    })
  }

  const localSuffix =
    state.mode === 'local' ? ` (local, depth ${state.depth})` : ''
  const headerChildren = [
    {
      tag: 'text',
      value: `Note graph: ${nodes.length} nodes, ${edges.length} links${localSuffix}`,
    },
    {
      tag: 'button',
      label: 'Recompute',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.recompute' },
    },
    {
      tag: 'button',
      label: 'Reset view',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.resetView' },
    },
    {
      tag: 'button',
      label: 'Zoom in',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.zoomIn' },
    },
    {
      tag: 'button',
      label: 'Zoom out',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.zoomOut' },
    },
    {
      tag: 'button',
      label: 'Pan left',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.panLeft' },
    },
    {
      tag: 'button',
      label: 'Pan right',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.panRight' },
    },
    {
      tag: 'button',
      label: 'Pan up',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.panUp' },
    },
    {
      tag: 'button',
      label: 'Pan down',
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.panDown' },
    },
  ]

  // Persistent "Selected" row. Note nodes get a clickable link that
  // opens the note through the wikilink:// intercept; tag nodes are
  // not notes, so they show a plain label.
  const pickedRow = (() => {
    if (!state.pickedNodeId) {
      return { tag: 'text', value: 'Selected: (click a node)' }
    }
    const picked = nodes.find((n) => n.id === state.pickedNodeId)
    if (!picked) {
      return { tag: 'text', value: 'Selected: (no longer in graph)' }
    }
    if (picked.kind === 'tag') {
      return {
        tag: 'text',
        value: `Selected tag: ${picked.title} (${picked.degree} notes)`,
      }
    }
    return {
      tag: 'box',
      gap: 2,
      children: [
        { tag: 'text', value: 'Selected:' },
        {
          tag: 'link',
          label: `Open "${picked.title}"`,
          href: { kind: 'note', noteId: picked.id },
        },
      ],
    }
  })()

  ctx.setFullscreenContent(VIEW_ID, {
    tag: 'box',
    gap: 3,
    children: [
      { tag: 'box', gap: 2, children: headerChildren },
      buildControls(),
      pickedRow,
      {
        tag: 'svg',
        width: LAYOUT_WIDTH,
        height: LAYOUT_HEIGHT,
        viewBox: [vx, vy, vw, vh],
        children: [
          {
            tag: 'rect',
            x: vx,
            y: vy,
            width: vw,
            height: vh,
            fill: '#0f172a',
          },
          ...lineNodes,
          ...circleNodes,
        ],
      },
    ],
  })
}

/**
 * Build the graph model honouring every G1 setting, then run the
 * force simulation. Sequence: derive base graph -> optionally add tag
 * nodes -> optionally restrict to the local neighbourhood -> optionally
 * drop orphans -> simulate.
 */
async function rebuildLayout(ctx) {
  const t0 = nowMs()
  const notes = await loadNotesSnapshot(ctx)
  const notesById = new Map(notes.map((n) => [n.id, n]))

  let graph = deriveGraph(notes)
  if (state.tagsAsNodes) {
    graph = deriveTagGraph(graph, notes)
  }
  if (state.mode === 'local') {
    const rootId = resolveActiveNoteId(ctx)
    graph = localGraph(graph, rootId, state.depth)
  }
  if (state.hideOrphans) {
    graph = dropOrphans(graph)
  }
  const t1 = nowMs()
  const positions = runForceSimulation(graph.nodes, graph.edges, {
    forces: state.forces,
  })
  const t2 = nowMs()
  state.layout = {
    nodes: graph.nodes,
    edges: graph.edges,
    positions,
    notesById,
  }
  // eslint-disable-next-line no-console
  console.log(
    `[noteser-graph] graph layout: derive=${(t1 - t0).toFixed(1)}ms ` +
      `simulate=${(t2 - t1).toFixed(1)}ms ` +
      `nodes=${graph.nodes.length} edges=${graph.edges.length} ` +
      `mode=${state.mode} tagsAsNodes=${state.tagsAsNodes} hideOrphans=${state.hideOrphans}`,
  )
}

/** Re-run the layout (node/edge set or positions changed) then paint. */
async function rebuildAndRender(ctx) {
  await rebuildLayout(ctx)
  renderFullscreen(ctx)
}

export default {
  id: 'noteser-graph',
  name: 'Graph',
  version: '0.2.0',
  author: 'Noteser',
  description:
    'Backlinks and unlinked mentions for the active note in the sidebar, plus a force-directed graph of the vault with local-graph, color groups, filters, force tuning, and tags-as-nodes. Closes issue #71.',
  permissions: ['vault.read.all', 'vault.events'],
  surfaces: {
    sidebarPanels: [{ id: PANEL_ID, title: 'Graph', icon: 'link' }],
    fullscreenViews: [{ id: VIEW_ID, title: 'Note graph' }],
    commands: [
      { id: 'open-graph', title: 'Graph: open global graph' },
      { id: 'recompute', title: 'Graph: recompute layout' },
    ],
  },

  onActivate(ctx) {
    state.ctx = ctx
    loadSettings(ctx)

    ctx.vault.events.onNoteSaved(() => {
      state.sha = null
      state.notes = null
      state.layout = null
      void renderPanel(ctx).catch(() => {})
      if (state.fullscreenMounted) {
        void rebuildAndRender(ctx).catch(() => {})
      }
    })

    ctx.vault.events.onActiveNoteChange((noteId) => {
      state.activeNoteId = noteId
      void renderPanel(ctx).catch(() => {})
      // A local graph is anchored on the active note, so follow it.
      if (state.fullscreenMounted && state.mode === 'local') {
        void rebuildAndRender(ctx).catch(() => {})
      }
    })

    ctx.onVNodeEvent(async ({ event, payload }) => {
      try {
        const value =
          payload && typeof payload === 'object' ? payload.value : undefined
        switch (event) {
          case 'graph.open':
            await ctx.openFullscreen(VIEW_ID)
            return
          case 'graph.recompute':
            state.sha = null
            state.notes = null
            state.layout = null
            state.viewport = { x: 0, y: 0, scale: 1 }
            await rebuildAndRender(ctx)
            return
          case 'graph.resetView':
            state.viewport = { x: 0, y: 0, scale: 1 }
            renderFullscreen(ctx)
            return
          case 'graph.zoomIn':
            state.viewport.scale = Math.max(0.25, state.viewport.scale * 0.8)
            renderFullscreen(ctx)
            return
          case 'graph.zoomOut':
            state.viewport.scale = Math.min(4, state.viewport.scale * 1.25)
            renderFullscreen(ctx)
            return
          case 'graph.panLeft':
            state.viewport.x -= LAYOUT_WIDTH * state.viewport.scale * 0.15
            renderFullscreen(ctx)
            return
          case 'graph.panRight':
            state.viewport.x += LAYOUT_WIDTH * state.viewport.scale * 0.15
            renderFullscreen(ctx)
            return
          case 'graph.panUp':
            state.viewport.y -= LAYOUT_HEIGHT * state.viewport.scale * 0.15
            renderFullscreen(ctx)
            return
          case 'graph.panDown':
            state.viewport.y += LAYOUT_HEIGHT * state.viewport.scale * 0.15
            renderFullscreen(ctx)
            return
          case 'graph.setMode': {
            const mode = value === 'local' ? 'local' : 'global'
            state.mode = mode
            persist(ctx, SETTING_KEYS.mode, mode)
            await rebuildAndRender(ctx)
            return
          }
          case 'graph.setDepth': {
            const depth = Number(value)
            state.depth = depth === 2 || depth === 3 ? depth : 1
            persist(ctx, SETTING_KEYS.depth, state.depth)
            await rebuildAndRender(ctx)
            return
          }
          case 'graph.setColorBy': {
            const colorBy = ['folder', 'tag', 'query'].includes(value)
              ? value
              : 'none'
            state.colorBy = colorBy
            persist(ctx, SETTING_KEYS.colorBy, colorBy)
            // Color is a render-only concern; no re-simulation needed.
            renderFullscreen(ctx)
            return
          }
          case 'graph.setColorQuery':
            state.colorQuery = typeof value === 'string' ? value : ''
            persist(ctx, SETTING_KEYS.colorQuery, state.colorQuery)
            renderFullscreen(ctx)
            return
          case 'graph.setSearch':
            state.search = typeof value === 'string' ? value : ''
            persist(ctx, SETTING_KEYS.search, state.search)
            renderFullscreen(ctx)
            return
          case 'graph.toggleOrphans':
            state.hideOrphans = !state.hideOrphans
            persist(ctx, SETTING_KEYS.hideOrphans, state.hideOrphans)
            await rebuildAndRender(ctx)
            return
          case 'graph.toggleTags':
            state.tagsAsNodes = !state.tagsAsNodes
            persist(ctx, SETTING_KEYS.tagsAsNodes, state.tagsAsNodes)
            await rebuildAndRender(ctx)
            return
          case 'graph.setForce': {
            const key =
              payload && typeof payload === 'object' ? payload.key : null
            if (key && key in DEFAULT_FORCES) {
              const next = { ...state.forces, [key]: Number(value) }
              state.forces = clampForces(next)
              persist(ctx, SETTING_KEYS.forces, state.forces)
              // Size multiplier is render-only; the four physics
              // forces need a fresh simulation.
              if (key === 'sizeMultiplier') {
                renderFullscreen(ctx)
              } else {
                await rebuildAndRender(ctx)
              }
            }
            return
          }
          case 'graph.resetForces':
            state.forces = { ...DEFAULT_FORCES }
            persist(ctx, SETTING_KEYS.forces, state.forces)
            await rebuildAndRender(ctx)
            return
          case 'graph.pickNode': {
            if (!payload || typeof payload !== 'object') return
            const id = String(payload.id ?? '')
            if (!id) return
            state.pickedNodeId = id
            renderFullscreen(ctx)
            return
          }
          default:
            return
        }
      } catch (err) {
        ctx.notify(err instanceof Error ? err.message : 'Graph action failed.')
      }
    })
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== PANEL_ID) return
    state.ctx = ctx
    state.activeNoteId = ctx.activeNote?.id ?? null
    return renderPanel(ctx)
  },

  onActiveNoteChange(note, ctx) {
    state.activeNoteId = note?.id ?? null
    if (state.fullscreenMounted && state.mode === 'local') {
      return rebuildAndRender(ctx)
    }
    return renderPanel(ctx)
  },

  async onCommand(commandId, ctx) {
    if (commandId === 'open-graph') {
      try {
        await ctx.openFullscreen(VIEW_ID)
      } catch (err) {
        ctx.notify(
          err instanceof Error ? err.message : 'Could not open graph view.',
        )
      }
      return
    }
    if (commandId === 'recompute') {
      state.sha = null
      state.notes = null
      state.layout = null
      if (state.fullscreenMounted) {
        await rebuildAndRender(ctx)
      } else {
        void renderPanel(ctx)
      }
      return
    }
  },

  async onFullscreenMount(viewId, ctx) {
    if (viewId !== VIEW_ID) return
    state.fullscreenMounted = true
    state.ctx = ctx
    state.viewport = { x: 0, y: 0, scale: 1 }
    renderFullscreen(ctx)
    await rebuildAndRender(ctx)
  },

  onFullscreenUnmount(viewId) {
    if (viewId !== VIEW_ID) return
    state.fullscreenMounted = false
    state.pickedNodeId = null
  },
}
