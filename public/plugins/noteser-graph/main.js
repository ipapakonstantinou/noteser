// noteser-graph v0.3.0
//
// Closes issue #71. Built on Plugin API v1.2 (PRs A, B, C, F + the
// VNode event delivery follow-up) and Plugin API v1.3 (L1-L4: pointer
// + wheel + hover events, host-owned pan/zoom with the
// `surface.transform` settle event, and the `worker:patchSvgPositions`
// position-patch fast path).
//
// Provides two surfaces:
//
//   1. A sidebar panel "Graph" for the ACTIVE note. Shows backlinks
//      and unlinked mentions plus a button that opens the global
//      graph in a fullscreen view.
//
//   2. A fullscreen view "Graph" containing a force-directed SVG of
//      the vault. v0.3.0 (the "G2-G5: interactive" increment) makes
//      the graph feel like Obsidian, on the v1.3 interaction surface:
//        - Wheel zoom + drag pan, owned by the host (instant, no
//          worker round-trip); the viewport persists across reload.
//        - Node drag: press a node to pin it under the pointer; the
//          simulation reheats around pinned nodes; per-frame position
//          patches keep a 500-node drag at 60fps. Click a pinned node
//          to unpin it, or use "Release pinned".
//        - Hover highlight: hovering a node dims every non-neighbour
//          and brightens the hovered node's edges.
//        - Click vs drag: a short, still press opens the note (via the
//          existing wikilink open affordance); a real drag never does.
//      v0.2.0 (the "G1: graph richness" increment) added, all on the
//      existing v1.2 VNode surface and with no platform change:
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

// --------------------- Interaction helpers (exported) ------------------
//
// Pure helpers for the v0.3.0 interactive layer (drag, wheel zoom, pan,
// hover highlight, click-vs-drag). Exported by name so the Jest suite
// can verify them without a live host. Runtime callers reach them
// through the closure.

/** The svg's full extent. The host-owned viewBox starts here, and a
 *  "reset view" returns to it. */
export const DEFAULT_VIEWPORT = { x: 0, y: 0, w: LAYOUT_WIDTH, h: LAYOUT_HEIGHT }

/**
 * Clamp a viewport box to finite numbers + a sane width/height so a
 * corrupt persisted setting or a degenerate transform cannot blow up
 * the rendered svg. The width/height bounds mirror the host's zoom
 * clamp (roughly 50x in or out of the base extent). Pure.
 */
export function clampViewport(vp) {
  const num = (v, def) => (Number.isFinite(v) ? v : def)
  const x = num(vp?.x, DEFAULT_VIEWPORT.x)
  const y = num(vp?.y, DEFAULT_VIEWPORT.y)
  const w = Math.min(
    LAYOUT_WIDTH * 50,
    Math.max(LAYOUT_WIDTH / 50, num(vp?.w, DEFAULT_VIEWPORT.w)),
  )
  const h = Math.min(
    LAYOUT_HEIGHT * 50,
    Math.max(LAYOUT_HEIGHT / 50, num(vp?.h, DEFAULT_VIEWPORT.h)),
  )
  return { x, y, w, h }
}

/**
 * Reconstruct the viewport box from a `surface.transform` settle event.
 *
 *   base      - { w, h } the viewBox dimensions the svg mounted with.
 *               The host fixes its `baseW`/`baseH` at mount and reports
 *               `scale = baseW / liveW`, so reconstructing the live
 *               width as `base.w / scale` round-trips exactly.
 *   transform - { x, y, scale } from the settle event.
 *
 * Returns the full box { x, y, w, h } in svg user space, clamped. Pure.
 * A no-op settle (scale 1, unchanged x/y) returns the base box, so the
 * persisted viewport survives a reload without drifting.
 */
export function viewportFromTransform(base, transform) {
  const scale =
    Number.isFinite(transform?.scale) && transform.scale > 0
      ? transform.scale
      : 1
  const bw = Number.isFinite(base?.w) && base.w > 0 ? base.w : LAYOUT_WIDTH
  const bh = Number.isFinite(base?.h) && base.h > 0 ? base.h : LAYOUT_HEIGHT
  return clampViewport({
    x: Number.isFinite(transform?.x) ? transform.x : 0,
    y: Number.isFinite(transform?.y) ? transform.y : 0,
    w: bw / scale,
    h: bh / scale,
  })
}

/** Movement (px, svg user space) below which a press counts as a click. */
export const TAP_MOVE_THRESHOLD = 4
/** Duration (ms) below which a press counts as a click, not a drag. */
export const TAP_TIME_THRESHOLD = 250

/**
 * Classify a pointerdown -> pointerup pair as a click (tap) or a drag.
 *
 *   start - { x, y, t }   pointerdown position (svg user space) + time
 *   end   - { x, y, t }   pointerup position + time
 *
 * Returns true only when BOTH the travel distance is at/under
 * TAP_MOVE_THRESHOLD and the elapsed time is at/under
 * TAP_TIME_THRESHOLD. A real drag (either threshold exceeded) returns
 * false, so it never opens the note. Pure.
 */
export function isTapGesture(start, end, opts) {
  if (!start || !end) return false
  const moveMax = opts?.moveThreshold ?? TAP_MOVE_THRESHOLD
  const timeMax = opts?.timeThreshold ?? TAP_TIME_THRESHOLD
  const dx = (end.x ?? 0) - (start.x ?? 0)
  const dy = (end.y ?? 0) - (start.y ?? 0)
  const dist = Math.sqrt(dx * dx + dy * dy)
  const dt = (end.t ?? 0) - (start.t ?? 0)
  return dist <= moveMax && dt <= timeMax
}

// Separator that cannot occur in a node id, used to key an edge as
// "source -> target" for the hover-incidence set.
const EDGE_KEY_SEP = ' '

/** Stable key for an edge in the hover-incidence set. */
export function edgeKey(source, target) {
  return String(source) + EDGE_KEY_SEP + String(target)
}

/**
 * Hover highlight set for `hoveredId`: the hovered node plus its direct
 * (1-hop, undirected) neighbours, and the set of edges incident to the
 * hovered node.
 *
 * Returns { nodes: Set<id>, edges: Set<edgeKey> }. Edge keys use the
 * SAME orientation as the input edge list (`edgeKey(e.source,
 * e.target)`) so a renderer iterating the same edges can test
 * incidence directly. O(edges). Pure.
 */
export function hoverNeighbours(edges, hoveredId) {
  const nodes = new Set()
  const incident = new Set()
  if (!hoveredId) return { nodes, edges: incident }
  nodes.add(hoveredId)
  for (const e of edges) {
    if (e.source === hoveredId) {
      nodes.add(e.target)
      incident.add(edgeKey(e.source, e.target))
    } else if (e.target === hoveredId) {
      nodes.add(e.source)
      incident.add(edgeKey(e.source, e.target))
    }
  }
  return { nodes, edges: incident }
}

/** Max per-axis speed below which the live reheat loop is "settled". */
export const SIM_SETTLE_SPEED = 0.4

/**
 * Run ONE force-simulation integration step over a live sim array,
 * honouring a per-node `fixed` flag.
 *
 *   sim   - [{ id, x, y, vx, vy, fixed }]   (MUTATED in place)
 *   edges - [{ source, target }]
 *   opts  - { forces, width, height }
 *
 * Pinned / dragged nodes (`fixed === true`) keep their position: their
 * velocity is zeroed and integration is skipped, but they STILL exert
 * repulsion + spring forces on the rest, so the layout resumes and
 * reheats AROUND them. Returns the same `sim` array (the live loop
 * reuses one array per drag; tests pass a fresh one). Mirrors the
 * physics of `runForceSimulation`, one iteration.
 */
export function simulationStep(sim, edges, opts) {
  const forces = clampForces(opts?.forces)
  const width = opts?.width ?? LAYOUT_WIDTH
  const height = opts?.height ?? LAYOUT_HEIGHT
  const cx = width / 2
  const cy = height / 2
  const N = sim.length
  const indexById = new Map()
  for (let i = 0; i < N; i++) indexById.set(sim[i].id, i)

  // Pair repulsion (O(n^2)).
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = sim[i]
      const b = sim[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) {
        // Coincident nodes: nudge apart deterministically.
        dx = 0.1
        dy = 0.1
        d2 = 0.02
      }
      const d = Math.sqrt(d2)
      const f = forces.repel / d2
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
    const delta = d - forces.linkDistance
    const fx = (dx / d) * delta * forces.linkForce
    const fy = (dy / d) * delta * forces.linkForce
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }

  // Center pull + damping + integration. Fixed nodes never move.
  for (let i = 0; i < N; i++) {
    const p = sim[i]
    if (p.fixed) {
      p.vx = 0
      p.vy = 0
      continue
    }
    p.vx += (cx - p.x) * forces.center
    p.vy += (cy - p.y) * forces.center
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
  return sim
}

/**
 * True when no UNPINNED node is still moving faster than `threshold`
 * (per axis), so the live reheat loop can stop. Pinned nodes are
 * ignored (they are held still on purpose). Pure.
 */
export function simIsSettled(sim, threshold) {
  const t = threshold ?? SIM_SETTLE_SPEED
  for (const p of sim) {
    if (p.fixed) continue
    if (Math.abs(p.vx) > t || Math.abs(p.vy) > t) return false
  }
  return true
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
  // G2: the host-owned viewport box, persisted from `surface.transform`.
  viewport: 'g2.viewport',
}

// State the runtime keeps across handler firings.
const state = {
  ctx: null,
  notes: null,
  sha: null,
  activeNoteId: null,
  layout: null, // { nodes, edges, positions, notesById }
  fullscreenMounted: false,
  pickedNodeId: null,

  // G2: host-owned pan/zoom viewport. `viewport` is the full viewBox
  // box `{ x, y, w, h }`; `viewportBase` is the box the svg mounted
  // with (the host's fixed baseW/baseH for the scale it reports in the
  // `surface.transform` settle event); `viewportEpoch` is folded into
  // the svg id so bumping it forces the host svg to remount and
  // re-init its pan/zoom state (used by "reset view" / recompute).
  viewport: { ...DEFAULT_VIEWPORT },
  viewportBase: { w: DEFAULT_VIEWPORT.w, h: DEFAULT_VIEWPORT.h },
  viewportEpoch: 0,

  // G3: live node-drag state.
  pinned: new Set(), // ids of pinned (fixed) nodes
  sim: null, // live [{ id, x, y, vx, vy, fixed }] during/after a drag
  simIndex: null, // Map(id -> sim node) for O(1) lookup
  dragId: null, // node currently under the pointer, or null
  dragStart: null, // { id, x, y, t, moved, wasPinned } for click-vs-drag
  simTimer: null, // reheat-loop setTimeout handle
  simFrames: 0, // frames run in the current loop (hard-stop guard)

  // G4: id of the node currently hovered, or null.
  hoveredId: null,

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

    const viewport = ctx.getSetting(SETTING_KEYS.viewport)
    if (viewport && typeof viewport === 'object') {
      state.viewport = clampViewport(viewport)
      state.viewportBase = { w: state.viewport.w, h: state.viewport.h }
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

// Edge + node colors. The hover highlight only recolors (no re-layout):
// non-neighbours mute to DIM_COLOR, the hovered node's edges brighten.
const EDGE_COLOR = '#475569'
const EDGE_MUTED = '#2a3142'
const EDGE_HILITE = '#94a3b8'
const NODE_STROKE = '#0f172a'
const HOVER_RING = '#e2e8f0' // ring on the hovered node
const PIN_RING = '#f59e0b' // ring on a pinned node (Obsidian-ish accent)

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
  const hover = state.hoveredId ? hoverNeighbours(edges, state.hoveredId) : null

  // The host owns the viewBox once `panZoom: 'host'` is set, so we
  // render from the persisted viewport box and let the host mutate it
  // live during pan/zoom. A control-driven re-render keeps the viewport
  // because the prop equals the last settled box (React no-ops on it).
  const vp = state.viewport
  const viewBox = [vp.x, vp.y, vp.w, vp.h]

  const lineNodes = []
  for (const e of edges) {
    const a = posById.get(e.source)
    const b = posById.get(e.target)
    if (!a || !b) continue
    let stroke = EDGE_COLOR
    let strokeWidth = 1
    if (hover) {
      if (hover.edges.has(edgeKey(e.source, e.target))) {
        stroke = EDGE_HILITE
        strokeWidth = 2
      } else {
        stroke = EDGE_MUTED
      }
    }
    lineNodes.push({
      tag: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke,
      strokeWidth,
      // L4 patch channel: tag each endpoint with the node id it follows
      // so a drag's per-frame position patch moves the edge with it.
      sourceId: e.source,
      targetId: e.target,
    })
  }
  const circleNodes = []
  for (const n of nodes) {
    const p = posById.get(n.id)
    if (!p) continue
    const r = Math.max(1, (4 + Math.min(8, n.degree)) * sizeMult)
    let fill = colors.get(n.id) ?? DEFAULT_NODE_COLOR
    let stroke = NODE_STROKE
    if (hover && !hover.nodes.has(n.id)) {
      // Dim every node that is neither the hovered node nor a neighbour.
      fill = DIM_COLOR
    }
    if (state.hoveredId === n.id) stroke = HOVER_RING
    if (state.pinned.has(n.id)) stroke = PIN_RING
    circleNodes.push({
      tag: 'circle',
      cx: p.x,
      cy: p.y,
      r,
      fill,
      stroke,
      // L1: echoed back as `payload.target`; also the L4 patch-channel id.
      id: n.id,
      // G3 drag + G5 click-vs-drag. The host auto-captures the pointer
      // because the circle declares both down + move.
      onPointerDown: { kind: 'emit', event: 'graph.nodeDown' },
      onPointerMove: { kind: 'emit', event: 'graph.nodeMove' },
      onPointerUp: { kind: 'emit', event: 'graph.nodeUp' },
      // G4 hover highlight.
      onPointerEnter: { kind: 'emit', event: 'graph.nodeEnter' },
      onPointerLeave: { kind: 'emit', event: 'graph.nodeLeave' },
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
  ]
  if (state.pinned.size > 0) {
    headerChildren.push({
      tag: 'button',
      label: `Release pinned (${state.pinned.size})`,
      variant: 'ghost',
      onClick: { kind: 'emit', event: 'graph.releasePinned' },
    })
  }

  // Persistent "Selected" row. A click (not a drag) on a note node sets
  // the picked id; the row then shows a wikilink link that opens the
  // note through the host's wikilink:// intercept. Tag nodes are not
  // notes, so they show a plain label.
  const pickedRow = (() => {
    if (!state.pickedNodeId) {
      return { tag: 'text', value: 'Selected: (click a node to open it)' }
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
        // Folding the epoch into the id makes the host remount the svg
        // (and re-init its pan/zoom baseW) on a hard viewport reset.
        id: 'graph-canvas-' + state.viewportEpoch,
        width: LAYOUT_WIDTH,
        height: LAYOUT_HEIGHT,
        viewBox,
        // Host owns pan (drag the background) + wheel zoom; it emits one
        // `surface.transform` settle event we persist.
        panZoom: 'host',
        children: [
          {
            // Generous background so panning/zooming still shows a
            // backdrop; it does not track the live viewBox.
            tag: 'rect',
            x: -LAYOUT_WIDTH,
            y: -LAYOUT_HEIGHT,
            width: LAYOUT_WIDTH * 3,
            height: LAYOUT_HEIGHT * 3,
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
  // A fresh layout invalidates the live drag state: positions, pins,
  // and hover all key off the previous node set.
  stopSimLoop()
  state.sim = null
  state.simIndex = null
  state.pinned.clear()
  state.dragId = null
  state.dragStart = null
  state.hoveredId = null

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

// ----------------------- Host-owned viewport (G2) ----------------------

/** Reset the viewport to fit + force the host svg to remount so its
 *  internal pan/zoom state (baseW) re-inits from the fresh viewBox. */
function resetViewport(ctx) {
  state.viewport = { ...DEFAULT_VIEWPORT }
  state.viewportBase = { w: DEFAULT_VIEWPORT.w, h: DEFAULT_VIEWPORT.h }
  state.viewportEpoch++
  persist(ctx, SETTING_KEYS.viewport, state.viewport)
}

// --------------------------- Node drag (G3) ----------------------------
//
// A press on a node pins it under the pointer. A background reheat loop
// runs one or two `simulationStep`s per frame keeping pinned nodes
// fixed, and streams ONLY the moved coordinates through the L4 patch
// channel (`ctx.patchSvgPositions`) so a 500-node drag never re-emits
// the whole SVG tree. The worker has no requestAnimationFrame, so the
// loop is driven by setTimeout at ~60fps.

const SIM_FRAME_MS = 16
const SIM_STEPS_PER_FRAME = 2
const SIM_MAX_FRAMES = 600 // hard stop (~10s) so a loop can never run away
const PATCH_EPSILON = 0.05 // px move below which a node is not re-patched

/** Build the live sim array from the cached layout positions, marking
 *  currently-pinned nodes fixed. Idempotent: keeps an existing sim. */
function ensureSim() {
  if (!state.layout) return
  if (state.sim) return
  state.sim = state.layout.positions.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    fixed: state.pinned.has(p.id),
  }))
  state.simIndex = new Map(state.sim.map((p) => [p.id, p]))
}

function stopSimLoop() {
  if (state.simTimer !== null) {
    clearTimeout(state.simTimer)
    state.simTimer = null
  }
  state.simFrames = 0
}

/** Start (or keep) the reheat loop. No-op if already running. */
function startSimLoop() {
  if (state.simTimer !== null) return
  state.simFrames = 0
  const tick = () => {
    state.simTimer = null
    const ctx = state.ctx
    if (!state.fullscreenMounted || !state.sim || !state.layout || !ctx) return

    for (let i = 0; i < SIM_STEPS_PER_FRAME; i++) {
      simulationStep(state.sim, state.layout.edges, { forces: state.forces })
    }

    // Sync sim -> cached positions (so a later re-render stays put) and
    // collect a patch for every node that actually moved.
    const posById = new Map(state.layout.positions.map((p) => [p.id, p]))
    const patches = []
    for (const p of state.sim) {
      const lp = posById.get(p.id)
      if (!lp) continue
      const moved =
        Math.abs(lp.x - p.x) > PATCH_EPSILON ||
        Math.abs(lp.y - p.y) > PATCH_EPSILON ||
        state.dragId === p.id
      lp.x = p.x
      lp.y = p.y
      if (moved) patches.push({ id: p.id, x: p.x, y: p.y })
    }
    if (patches.length && typeof ctx.patchSvgPositions === 'function') {
      try {
        ctx.patchSvgPositions({ viewId: VIEW_ID, patches })
      } catch {
        // Patch channel best-effort; a dropped frame is harmless.
      }
    }

    state.simFrames++
    const keepGoing =
      state.dragId !== null ||
      (!simIsSettled(state.sim) && state.simFrames < SIM_MAX_FRAMES)
    if (keepGoing) {
      state.simTimer = setTimeout(tick, SIM_FRAME_MS)
    }
  }
  state.simTimer = setTimeout(tick, SIM_FRAME_MS)
}

/** Stop the loop if nothing is being dragged and the layout has come to
 *  rest, leaving the cached positions final. */
function maybeStopSimLoop() {
  if (
    state.simTimer !== null &&
    state.dragId === null &&
    (!state.sim || simIsSettled(state.sim))
  ) {
    stopSimLoop()
  }
}

/** Unpin a node and reheat so it can settle back into the layout. */
function unpin(id) {
  state.pinned.delete(id)
  const node = state.simIndex?.get(id)
  if (node) node.fixed = false
  if (state.sim) startSimLoop()
}

/** Read a finite coordinate off a pointer payload, or null. */
function payloadCoord(payload, key) {
  const v = Number(payload?.[key])
  return Number.isFinite(v) ? v : null
}

/** Pointerdown on a node: tentatively pin it under the pointer and
 *  record the gesture start so pointerup can tell a click from a drag. */
function handleNodeDown(payload) {
  if (!state.layout) return
  const id = String(payload?.target ?? '')
  if (!id) return
  ensureSim()
  const node = state.simIndex?.get(id)
  const px = payloadCoord(payload, 'x')
  const py = payloadCoord(payload, 'y')
  state.dragId = id
  state.dragStart = {
    id,
    x: px ?? node?.x ?? 0,
    y: py ?? node?.y ?? 0,
    t: nowMs(),
    moved: false,
    wasPinned: state.pinned.has(id),
  }
  // Pin it so the reheat loop holds it still under the pointer.
  state.pinned.add(id)
  if (node) {
    node.fixed = true
    node.vx = 0
    node.vy = 0
    if (px !== null) node.x = px
    if (py !== null) node.y = py
  }
  startSimLoop()
}

/** Pointermove while dragging: move the pinned node to the pointer. The
 *  reheat loop streams the position patch + reheats neighbours. */
function handleNodeMove(payload) {
  const id = state.dragId
  if (!id || !state.sim) return
  const node = state.simIndex?.get(id)
  if (!node) return
  const px = payloadCoord(payload, 'x')
  const py = payloadCoord(payload, 'y')
  if (px !== null) node.x = px
  if (py !== null) node.y = py
  node.fixed = true
  node.vx = 0
  node.vy = 0
  if (state.dragStart && !state.dragStart.moved && px !== null && py !== null) {
    const dx = px - state.dragStart.x
    const dy = py - state.dragStart.y
    if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_THRESHOLD) {
      state.dragStart.moved = true
    }
  }
  startSimLoop()
}

/**
 * Pointerup on a node. Distinguishes a click from a drag:
 *  - Click (small move, short time): if the node was already pinned,
 *    UNPIN it (Obsidian-style toggle). Otherwise release the tentative
 *    pin and select it, surfacing the wikilink open affordance.
 *  - Drag: keep it pinned (Obsidian behaviour); the loop settles the
 *    neighbours and stops.
 */
function handleNodeUp(ctx, payload) {
  const ds = state.dragStart
  const id = state.dragId
  state.dragId = null
  state.dragStart = null
  if (!ds || !id) {
    maybeStopSimLoop()
    return
  }
  const node = state.simIndex?.get(id)
  const px = payloadCoord(payload, 'x')
  const py = payloadCoord(payload, 'y')
  const end = {
    x: px ?? node?.x ?? ds.x,
    y: py ?? node?.y ?? ds.y,
    t: nowMs(),
  }
  const tap = isTapGesture({ x: ds.x, y: ds.y, t: ds.t }, end) && !ds.moved
  if (tap) {
    if (ds.wasPinned) {
      // A click on an already-pinned node unpins it.
      unpin(id)
    } else {
      // A click on a free node is an OPEN intent, not a drag: drop the
      // tentative pin and select it so the open link appears.
      unpin(id)
      state.pickedNodeId = id
    }
  }
  // Re-render once so the pin ring + "Release pinned" button (drag) or
  // the selection/open link (click) reflect the new state. The reheat
  // loop keeps streaming position patches on top of this.
  renderFullscreen(ctx)
  maybeStopSimLoop()
}

export default {
  id: 'noteser-graph',
  name: 'Graph',
  version: '0.3.0',
  author: 'Noteser',
  description:
    'Backlinks and unlinked mentions for the active note in the sidebar, plus an interactive force-directed graph of the vault: drag to pin nodes, wheel to zoom, drag the background to pan, hover to highlight neighbours, with local-graph, color groups, filters, force tuning, and tags-as-nodes. Closes issue #71.',
  permissions: ['vault.read.all', 'vault.events'],
  surfaces: {
    sidebarPanels: [{ id: PANEL_ID, title: 'Graph', icon: 'link' }],
    fullscreenViews: [
      {
        id: VIEW_ID,
        title: 'Note graph',
        interaction: { pointer: true, wheel: true, hover: true },
      },
    ],
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
            resetViewport(ctx)
            await rebuildAndRender(ctx)
            return
          case 'graph.resetView':
            resetViewport(ctx)
            renderFullscreen(ctx)
            return
          case 'surface.transform':
            // Host-owned pan/zoom settle. The host already applied the
            // viewBox to the DOM, so we only record + persist the new
            // viewport; re-rendering here would be redundant (and could
            // fight the live DOM).
            if (payload && typeof payload === 'object') {
              state.viewport = viewportFromTransform(
                state.viewportBase,
                payload,
              )
              persist(ctx, SETTING_KEYS.viewport, state.viewport)
            }
            return
          case 'graph.nodeDown':
            handleNodeDown(payload)
            return
          case 'graph.nodeMove':
            handleNodeMove(payload)
            return
          case 'graph.nodeUp':
            handleNodeUp(ctx, payload)
            return
          case 'graph.nodeEnter': {
            // Ignore hover while dragging (the pointer is captured by
            // the dragged node, so enter/leave on others are noise).
            if (state.dragId !== null) return
            const id = String(payload?.target ?? '')
            if (!id || state.hoveredId === id) return
            state.hoveredId = id
            renderFullscreen(ctx)
            return
          }
          case 'graph.nodeLeave': {
            if (state.dragId !== null) return
            const id = String(payload?.target ?? '')
            // Only clear when leaving the node we believe is hovered, so
            // a stale enter/leave pair cannot wipe a fresh hover.
            if (state.hoveredId && (!id || id === state.hoveredId)) {
              state.hoveredId = null
              renderFullscreen(ctx)
            }
            return
          }
          case 'graph.releasePinned':
            if (state.pinned.size === 0) return
            for (const id of Array.from(state.pinned)) unpin(id)
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
    // Restore the persisted viewport (loaded in onActivate). The svg
    // mounts with this box, so the host's baseW equals viewportBase.w —
    // keep them in sync so the first `surface.transform` round-trips.
    state.viewport = clampViewport(state.viewport)
    state.viewportBase = { w: state.viewport.w, h: state.viewport.h }
    state.viewportEpoch++
    renderFullscreen(ctx)
    await rebuildAndRender(ctx)
  },

  onFullscreenUnmount(viewId) {
    if (viewId !== VIEW_ID) return
    stopSimLoop()
    state.fullscreenMounted = false
    state.pickedNodeId = null
    state.sim = null
    state.simIndex = null
    state.pinned.clear()
    state.dragId = null
    state.dragStart = null
    state.hoveredId = null
  },
}
