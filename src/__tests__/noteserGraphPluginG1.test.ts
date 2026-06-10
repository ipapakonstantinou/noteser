/**
 * noteserGraphPluginG1.test.ts
 *
 * Tests for the pure helpers added in the "G1: graph richness"
 * increment of `public/plugins/noteser-graph/main.js`:
 *   - inline tag extraction (code/wikilink masking, nested tags)
 *   - tags-as-nodes graph synthesis
 *   - BFS local-graph neighbourhood + subgraph restriction
 *   - orphan filtering
 *   - degree recomputation
 *   - color group assignment (folder / tag / query) + search dim
 *   - force clamping + tunable simulation
 *
 * The plugin module is plain JS so TS infers loose types; each export
 * is re-cast to a test-facing signature for readability.
 */

import * as pluginModule from '../../public/plugins/noteser-graph/main.js'

interface GNode {
  id: string
  title: string
  degree: number
  kind?: string
}
interface GEdge {
  source: string
  target: string
}
interface Graph {
  nodes: GNode[]
  edges: GEdge[]
}

const extractTagsInline = pluginModule.extractTagsInline as (
  body: string,
) => string[]
const deriveGraph = pluginModule.deriveGraph as (
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
) => Graph
const deriveTagGraph = pluginModule.deriveTagGraph as (
  base: Graph,
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
) => Graph
const tagNodeId = pluginModule.tagNodeId as (name: string) => string
const bfsNeighbourhood = pluginModule.bfsNeighbourhood as (
  edges: ReadonlyArray<GEdge>,
  rootId: string | null,
  depth: number,
) => Set<string>
const subgraphForIds = pluginModule.subgraphForIds as (
  graph: Graph,
  idSet: Set<string>,
) => Graph
const localGraph = pluginModule.localGraph as (
  graph: Graph,
  rootId: string | null,
  depth: number,
) => Graph
const dropOrphans = pluginModule.dropOrphans as (graph: Graph) => Graph
const recomputeDegree = pluginModule.recomputeDegree as (
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
) => GNode[]
const noteMatchesQuery = pluginModule.noteMatchesQuery as (
  note: { title?: string; body?: string },
  query: string,
) => boolean
const colorForKey = pluginModule.colorForKey as (key: string) => string
const computeNodeColors = pluginModule.computeNodeColors as (
  nodes: ReadonlyArray<GNode>,
  notesById: Map<string, { title?: string; body?: string; folderPath?: string }>,
  opts: { colorBy?: string; colorQuery?: string; search?: string },
) => Map<string, string>
const clampForces = pluginModule.clampForces as (
  forces: Record<string, number> | null | undefined,
) => {
  center: number
  repel: number
  linkForce: number
  linkDistance: number
  sizeMultiplier: number
}
const runForceSimulation = pluginModule.runForceSimulation as (
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  opts?: {
    width?: number
    height?: number
    iterations?: number
    forces?: Record<string, number>
  },
) => Array<{ id: string; x: number; y: number }>
const DEFAULT_NODE_COLOR = pluginModule.DEFAULT_NODE_COLOR as string
const TAG_NODE_COLOR = pluginModule.TAG_NODE_COLOR as string
const QUERY_HIT_COLOR = pluginModule.QUERY_HIT_COLOR as string
const DIM_COLOR = pluginModule.DIM_COLOR as string
const DEFAULT_FORCES = pluginModule.DEFAULT_FORCES as Record<string, number>

function note(id: string, title: string, body: string, folderPath = '') {
  return { id, title, body, folderPath }
}

describe('extractTagsInline', () => {
  test('extracts distinct tags lowercased, hash stripped', () => {
    expect(extractTagsInline('a #Work and #ideas plus #Work again')).toEqual([
      'work',
      'ideas',
    ])
  })

  test('keeps nested tags with slashes', () => {
    expect(extractTagsInline('see #work/projects/q1 here')).toEqual([
      'work/projects/q1',
    ])
  })

  test('ignores tags inside fenced code blocks', () => {
    const body = 'real #tag here\n```\n#notatag in code\n```\n'
    expect(extractTagsInline(body)).toEqual(['tag'])
  })

  test('ignores tags inside inline code', () => {
    expect(extractTagsInline('a `#nope` but #yes counts')).toEqual(['yes'])
  })

  test('returns [] for empty / hash-free input', () => {
    expect(extractTagsInline('')).toEqual([])
    expect(extractTagsInline('no tags at all')).toEqual([])
  })

  test('does not treat a mid-word hash as a tag', () => {
    expect(extractTagsInline('foo#bar baz')).toEqual([])
  })
})

describe('deriveTagGraph', () => {
  const notes = [
    note('a', 'A', 'links [[B]] and #shared #alpha'),
    note('b', 'B', 'has #shared too'),
    note('c', 'C', 'no tags'),
  ]

  test('adds one node per distinct tag with kind tag', () => {
    const base = deriveGraph(notes)
    const g = deriveTagGraph(base, notes)
    const tagNodes = g.nodes.filter((n) => n.kind === 'tag')
    expect(tagNodes.map((n) => n.title).sort()).toEqual(['#alpha', '#shared'])
  })

  test('adds an edge from each note to each of its tags', () => {
    const base = deriveGraph(notes)
    const g = deriveTagGraph(base, notes)
    const sharedId = tagNodeId('shared')
    const edgesToShared = g.edges.filter((e) => e.target === sharedId)
    expect(edgesToShared.map((e) => e.source).sort()).toEqual(['a', 'b'])
  })

  test('preserves the original wikilink edges', () => {
    const base = deriveGraph(notes)
    const g = deriveTagGraph(base, notes)
    expect(g.edges).toContainEqual({ source: 'a', target: 'b' })
  })

  test('tag node degree counts linking notes', () => {
    const base = deriveGraph(notes)
    const g = deriveTagGraph(base, notes)
    const shared = g.nodes.find((n) => n.id === tagNodeId('shared'))
    expect(shared?.degree).toBe(2)
  })

  test('does not mutate the base graph', () => {
    const base = deriveGraph(notes)
    const baseNodeCount = base.nodes.length
    const baseEdgeCount = base.edges.length
    deriveTagGraph(base, notes)
    expect(base.nodes).toHaveLength(baseNodeCount)
    expect(base.edges).toHaveLength(baseEdgeCount)
  })
})

describe('bfsNeighbourhood', () => {
  // a - b - c - d ; e isolated. Plus a - f (so a has two neighbours).
  const edges: GEdge[] = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
    { source: 'a', target: 'f' },
  ]

  test('depth 1 returns root + direct neighbours', () => {
    const set = bfsNeighbourhood(edges, 'a', 1)
    expect([...set].sort()).toEqual(['a', 'b', 'f'])
  })

  test('depth 2 reaches two hops', () => {
    const set = bfsNeighbourhood(edges, 'a', 2)
    expect([...set].sort()).toEqual(['a', 'b', 'c', 'f'])
  })

  test('depth 3 reaches the far end', () => {
    const set = bfsNeighbourhood(edges, 'a', 3)
    expect([...set].sort()).toEqual(['a', 'b', 'c', 'd', 'f'])
  })

  test('treats edges as undirected', () => {
    const set = bfsNeighbourhood(edges, 'd', 1)
    expect([...set].sort()).toEqual(['c', 'd'])
  })

  test('isolated root returns only itself', () => {
    expect([...bfsNeighbourhood(edges, 'e', 3)]).toEqual(['e'])
  })

  test('null / empty root returns empty set', () => {
    expect(bfsNeighbourhood(edges, null, 2).size).toBe(0)
    expect(bfsNeighbourhood(edges, '', 2).size).toBe(0)
  })
})

describe('subgraphForIds + localGraph', () => {
  const graph: Graph = {
    nodes: [
      { id: 'a', title: 'A', degree: 2 },
      { id: 'b', title: 'B', degree: 2 },
      { id: 'c', title: 'C', degree: 2 },
      { id: 'd', title: 'D', degree: 1 },
    ],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ],
  }

  test('subgraphForIds drops nodes + dangling edges and recomputes degree', () => {
    const sub = subgraphForIds(graph, new Set(['a', 'b']))
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(sub.edges).toEqual([{ source: 'a', target: 'b' }])
    expect(sub.nodes.find((n) => n.id === 'a')?.degree).toBe(1)
  })

  test('localGraph depth 1 keeps the root and its neighbours', () => {
    const local = localGraph(graph, 'b', 1)
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(local.edges).toHaveLength(2)
  })

  test('localGraph depth 2 widens the neighbourhood', () => {
    const local = localGraph(graph, 'a', 2)
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('dropOrphans + recomputeDegree', () => {
  test('recomputeDegree counts in + out per node', () => {
    const nodes: GNode[] = [
      { id: 'a', title: 'A', degree: 0 },
      { id: 'b', title: 'B', degree: 0 },
      { id: 'c', title: 'C', degree: 0 },
    ]
    const edges: GEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const out = recomputeDegree(nodes, edges)
    const byId = new Map(out.map((n) => [n.id, n.degree]))
    expect(byId.get('a')).toBe(1)
    expect(byId.get('b')).toBe(2)
    expect(byId.get('c')).toBe(1)
  })

  test('dropOrphans removes degree-0 nodes only', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', title: 'A', degree: 0 },
        { id: 'b', title: 'B', degree: 0 },
        { id: 'orphan', title: 'O', degree: 99 }, // stale degree
      ],
      edges: [{ source: 'a', target: 'b' }],
    }
    const out = dropOrphans(graph)
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})

describe('noteMatchesQuery', () => {
  test('matches title or body case-insensitively', () => {
    expect(noteMatchesQuery({ title: 'Roadmap', body: '' }, 'road')).toBe(true)
    expect(noteMatchesQuery({ title: 'X', body: 'see the WIDGET' }, 'widget')).toBe(true)
  })
  test('returns false on miss or empty query', () => {
    expect(noteMatchesQuery({ title: 'X', body: 'y' }, 'zzz')).toBe(false)
    expect(noteMatchesQuery({ title: 'X', body: 'y' }, '')).toBe(false)
  })
})

describe('colorForKey', () => {
  test('is deterministic and returns a hex color', () => {
    const c1 = colorForKey('folder:Work')
    const c2 = colorForKey('folder:Work')
    expect(c1).toBe(c2)
    expect(c1).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('computeNodeColors', () => {
  const nodes: GNode[] = [
    { id: 'a', title: 'A', degree: 1, kind: 'note' },
    { id: 'b', title: 'B', degree: 1, kind: 'note' },
    { id: 't', title: '#x', degree: 1, kind: 'tag' },
  ]
  const notesById = new Map<
    string,
    { title?: string; body?: string; folderPath?: string }
  >([
    ['a', { title: 'A', body: 'has #x tag', folderPath: 'Work' }],
    ['b', { title: 'B', body: 'plain widget note', folderPath: 'Personal' }],
  ])

  test('colorBy none leaves note nodes at the default color', () => {
    const m = computeNodeColors(nodes, notesById, { colorBy: 'none' })
    expect(m.get('a')).toBe(DEFAULT_NODE_COLOR)
    expect(m.get('b')).toBe(DEFAULT_NODE_COLOR)
  })

  test('tag nodes always take the tag color', () => {
    const m = computeNodeColors(nodes, notesById, { colorBy: 'folder' })
    expect(m.get('t')).toBe(TAG_NODE_COLOR)
  })

  test('colorBy folder gives different folders different colors', () => {
    const m = computeNodeColors(nodes, notesById, { colorBy: 'folder' })
    expect(m.get('a')).not.toBe(m.get('b'))
    expect(m.get('a')).toBe(colorForKey('folder:Work'))
  })

  test('colorBy query highlights only matching notes', () => {
    const m = computeNodeColors(nodes, notesById, {
      colorBy: 'query',
      colorQuery: 'widget',
    })
    expect(m.get('a')).toBe(DEFAULT_NODE_COLOR)
    expect(m.get('b')).toBe(QUERY_HIT_COLOR)
  })

  test('search dims non-matching nodes regardless of group', () => {
    const m = computeNodeColors(nodes, notesById, {
      colorBy: 'folder',
      search: 'widget',
    })
    expect(m.get('a')).toBe(DIM_COLOR) // A has no "widget"
    expect(m.get('b')).not.toBe(DIM_COLOR) // B matches
  })
})

describe('clampForces', () => {
  test('fills defaults from undefined', () => {
    expect(clampForces(undefined)).toEqual(DEFAULT_FORCES)
  })

  test('clamps out-of-range values into bounds', () => {
    const out = clampForces({
      center: 99,
      repel: -10,
      linkForce: 5,
      linkDistance: 0,
      sizeMultiplier: 100,
    })
    expect(out.center).toBeLessThanOrEqual(0.2)
    expect(out.repel).toBe(0)
    expect(out.linkForce).toBeLessThanOrEqual(1)
    expect(out.linkDistance).toBeGreaterThanOrEqual(1)
    expect(out.sizeMultiplier).toBeLessThanOrEqual(5)
  })

  test('replaces NaN with the default', () => {
    expect(clampForces({ repel: NaN } as Record<string, number>).repel).toBe(
      DEFAULT_FORCES.repel,
    )
  })
})

describe('runForceSimulation force tuning', () => {
  const nodes: GNode[] = [
    { id: 'a', title: 'A', degree: 1 },
    { id: 'b', title: 'B', degree: 1 },
  ]
  const edges: GEdge[] = [{ source: 'a', target: 'b' }]

  test('default forces reproduce the legacy layout', () => {
    const a = runForceSimulation(nodes, edges, { iterations: 20 })
    const b = runForceSimulation(nodes, edges, {
      iterations: 20,
      forces: { ...DEFAULT_FORCES },
    })
    expect(a).toEqual(b)
  })

  test('a stronger repel pushes the two nodes farther apart', () => {
    const dist = (
      ps: Array<{ id: string; x: number; y: number }>,
    ): number => {
      const pa = ps.find((p) => p.id === 'a')!
      const pb = ps.find((p) => p.id === 'b')!
      return Math.hypot(pa.x - pb.x, pa.y - pb.y)
    }
    const low = runForceSimulation(nodes, edges, {
      iterations: 60,
      forces: { ...DEFAULT_FORCES, repel: 100, linkForce: 0 },
    })
    const high = runForceSimulation(nodes, edges, {
      iterations: 60,
      forces: { ...DEFAULT_FORCES, repel: 4000, linkForce: 0 },
    })
    expect(dist(high)).toBeGreaterThan(dist(low))
  })
})
