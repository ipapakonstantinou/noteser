/**
 * noteserGraphPlugin.test.ts
 *
 * Tests for the pure derivation helpers in
 * `public/plugins/noteser-graph/main.js`. The plugin is a
 * self-contained ES module — the worker dynamic-imports it via a
 * Blob URL at runtime, but Jest can import it like any other ESM.
 *
 * Coverage targets per the issue brief:
 *   - Unlinked-mention detector: code-block exclusion + wikilink
 *     exclusion + whole-word match.
 *   - Graph derivation on a 5-note fixture.
 */

import * as pluginModule from '../../public/plugins/noteser-graph/main.js'

// The plugin module is plain JS so TS infers loose types. Re-cast
// each named export to the test-facing signature here so individual
// tests stay readable.
const extractWikilinks = pluginModule.extractWikilinks as (
  body: string,
) => string[]
const maskCodeAndWikilinks = pluginModule.maskCodeAndWikilinks as (
  body: string,
) => string
const findUnlinkedMentions = pluginModule.findUnlinkedMentions as (
  body: string,
  title: string,
) => { count: number; snippet: string | null }
const findUnlinkedMentionsAcross = pluginModule.findUnlinkedMentionsAcross as (
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
  targetId: string,
  targetTitle: string,
) => Array<{ id: string; title: string; count: number; snippet: string | null }>
const findBacklinks = pluginModule.findBacklinks as (
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
  targetId: string,
  targetTitle: string,
) => Array<{ id: string; title: string }>
const deriveGraph = pluginModule.deriveGraph as (
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
) => {
  nodes: Array<{ id: string; title: string; degree: number }>
  edges: Array<{ source: string; target: string }>
}
const snapshotSha = pluginModule.snapshotSha as (
  notes: ReadonlyArray<{ id: string; updatedAt?: number }>,
) => string
const runForceSimulation = pluginModule.runForceSimulation as (
  nodes: ReadonlyArray<{ id: string; title: string; degree: number }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
  opts?: { width?: number; height?: number; iterations?: number },
) => Array<{ id: string; x: number; y: number }>

interface PluginNoteFixture {
  id: string
  title: string
  body: string
  updatedAt?: number
}

function note(
  id: string,
  title: string,
  body: string,
  updatedAt = 0,
): PluginNoteFixture {
  return { id, title, body, updatedAt }
}

describe('extractWikilinks', () => {
  test('returns all wikilink targets lowercased', () => {
    expect(extractWikilinks('see [[Alpha]] and [[Bravo]]')).toEqual([
      'alpha',
      'bravo',
    ])
  })

  test('strips alias after pipe', () => {
    expect(extractWikilinks('[[Alpha|display]] [[Beta|x]]')).toEqual([
      'alpha',
      'beta',
    ])
  })

  test('returns [] for empty / wikilink-free input', () => {
    expect(extractWikilinks('')).toEqual([])
    expect(extractWikilinks('plain text only')).toEqual([])
  })
})

describe('maskCodeAndWikilinks', () => {
  test('masks fenced code blocks with same-length spaces', () => {
    const body = 'before\n```\ncode line\n```\nafter'
    const masked = maskCodeAndWikilinks(body)
    expect(masked).toHaveLength(body.length)
    expect(masked).toContain('before')
    expect(masked).toContain('after')
    expect(masked).not.toContain('code line')
  })

  test('masks inline code spans', () => {
    const masked = maskCodeAndWikilinks('hello `target` world')
    expect(masked).not.toContain('target')
    expect(masked).toContain('hello')
    expect(masked).toContain('world')
  })

  test('masks existing wikilinks', () => {
    const masked = maskCodeAndWikilinks('see [[Alpha]] today')
    expect(masked).not.toContain('Alpha')
    expect(masked).toContain('see')
    expect(masked).toContain('today')
  })

  test('preserves offsets for mixed input', () => {
    const body = '[[A]] then `x` and ```\ny\n``` end'
    const masked = maskCodeAndWikilinks(body)
    expect(masked.length).toBe(body.length)
  })
})

describe('findUnlinkedMentions', () => {
  test('returns null when title is empty / whitespace', () => {
    expect(findUnlinkedMentions('Alpha here', '')).toBeNull()
    expect(findUnlinkedMentions('Alpha here', '   ')).toBeNull()
  })

  test('counts a single plain mention', () => {
    const r = findUnlinkedMentions('Read about Alpha for context.', 'Alpha')
    expect(r.count).toBe(1)
    expect(r.snippet).toContain('Alpha')
  })

  test('counts multiple mentions, case-insensitive', () => {
    const r = findUnlinkedMentions(
      'alpha leads. ALPHA next. Alpha again.',
      'Alpha',
    )
    expect(r.count).toBe(3)
  })

  test('skips mentions inside wikilinks', () => {
    const r = findUnlinkedMentions('see [[Alpha]] only, no plain mention', 'Alpha')
    expect(r.count).toBe(0)
  })

  test('counts plain mention when one wikilink and one plain co-exist', () => {
    const r = findUnlinkedMentions('Alpha appears, also [[Alpha]] here.', 'Alpha')
    expect(r.count).toBe(1)
  })

  test('skips mentions inside fenced code blocks', () => {
    const body = 'no plain here\n```\nAlpha is in code\n```\nafter'
    const r = findUnlinkedMentions(body, 'Alpha')
    expect(r.count).toBe(0)
  })

  test('skips mentions inside inline code spans', () => {
    const r = findUnlinkedMentions('the `Alpha` token in code', 'Alpha')
    expect(r.count).toBe(0)
  })

  test('whole-word match — does not match a substring', () => {
    const r = findUnlinkedMentions(
      'Alphabet is a word. Alphabetical too. Alpha by itself.',
      'Alpha',
    )
    expect(r.count).toBe(1)
  })

  test('counts mentions even with surrounding punctuation', () => {
    const r = findUnlinkedMentions(
      'Alpha, Alpha! Alpha. (Alpha) "Alpha"',
      'Alpha',
    )
    expect(r.count).toBe(5)
  })

  test('handles a multi-word title', () => {
    const r = findUnlinkedMentions(
      'I saw Project Apollo at the demo. Project Apollo rocks.',
      'Project Apollo',
    )
    expect(r.count).toBe(2)
  })

  test('returns snippet around the first match', () => {
    const r = findUnlinkedMentions(
      'a b c d e f g Alpha h i j k l m n',
      'Alpha',
    )
    expect(r.snippet).toContain('Alpha')
  })
})

describe('findUnlinkedMentionsAcross', () => {
  test('returns one entry per note, excludes target + backlinkers', () => {
    const target = note('t', 'Alpha', 'self body')
    const a = note('a', 'A', 'see [[Alpha]]') // backlinker
    const b = note('b', 'B', 'plain mention of Alpha here')
    const c = note('c', 'C', 'no relevant content')
    const out = findUnlinkedMentionsAcross([target, a, b, c], 't', 'Alpha')
    expect(out.map((m: { id: string }) => m.id).sort()).toEqual(['b'])
    expect(out[0].count).toBe(1)
  })

  test('multiple mentions in one note → one entry, count > 1', () => {
    const target = note('t', 'Alpha', '')
    const linker = note('a', 'A', 'Alpha here. Alpha there. Alpha everywhere.')
    const out = findUnlinkedMentionsAcross([target, linker], 't', 'Alpha')
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(3)
  })
})

describe('findBacklinks', () => {
  test('lists every linker once, excludes target', () => {
    const target = note('t', 'Alpha', 'self body')
    const a = note('a', 'A', 'one [[Alpha]] here')
    const b = note('b', 'B', 'two: [[Alpha]] and [[Alpha]]')
    const c = note('c', 'C', 'no wikilinks at all')
    const out = findBacklinks([target, a, b, c], 't', 'Alpha')
    expect(out.map((r: { id: string }) => r.id).sort()).toEqual(['a', 'b'])
  })

  test('case-insensitive title match', () => {
    const target = note('t', 'Project Apollo', '')
    const linker = note('a', 'A', 'go read [[project apollo]] later')
    expect(findBacklinks([target, linker], 't', 'Project Apollo')).toHaveLength(1)
  })

  test('returns [] when target title is empty', () => {
    expect(findBacklinks([], 't', '')).toEqual([])
    expect(findBacklinks([], 't', '   ')).toEqual([])
  })
})

describe('deriveGraph — 5-note fixture', () => {
  // Five notes: A -> B, A -> C, B -> C, D -> A. E is an orphan.
  // C also has a self-link that must be dropped, and A links to B
  // twice; both wikilinks should collapse into one edge.
  const fixture = [
    note('a', 'A', 'links to [[B]] and [[C]] and again [[B]]'),
    note('b', 'B', 'links to [[C]]'),
    note('c', 'C', 'links to [[C]]'), // self-link
    note('d', 'D', 'links to [[A]]'),
    note('e', 'E', 'no links here'),
  ]

  test('every note becomes one node', () => {
    const g = deriveGraph(fixture)
    expect(g.nodes.map((n: { id: string }) => n.id).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  test('drops self-links and de-duplicates parallel edges', () => {
    const g = deriveGraph(fixture)
    const keys = g.edges
      .map((e: { source: string; target: string }) => `${e.source}->${e.target}`)
      .sort()
    expect(keys).toEqual(['a->b', 'a->c', 'b->c', 'd->a'])
  })

  test('degree counts in + out for each node', () => {
    const g = deriveGraph(fixture)
    const byId = new Map(
      g.nodes.map((n: { id: string; degree: number }) => [n.id, n.degree]),
    )
    expect(byId.get('a')).toBe(3) // out: B, C; in: D
    expect(byId.get('b')).toBe(2) // out: C; in: A
    expect(byId.get('c')).toBe(2) // in: A, B
    expect(byId.get('d')).toBe(1) // out: A
    expect(byId.get('e')).toBe(0) // isolated
  })

  test('orphans still appear as nodes with degree 0', () => {
    const g = deriveGraph(fixture)
    const e = g.nodes.find((n) => n.id === 'e')
    expect(e).toBeDefined()
    expect(e?.degree).toBe(0)
  })

  test('case-insensitive resolution', () => {
    const notes = [
      note('a', 'Alpha', ''),
      note('b', 'Beta', 'see [[ALPHA]] then [[alpha]]'),
    ]
    const g = deriveGraph(notes)
    expect(g.edges).toEqual([{ source: 'b', target: 'a' }])
  })

  test('untitled notes cannot be link targets but can be link sources', () => {
    const notes = [
      note('a', '', 'see [[B]]'), // a is untitled, but can still link out
      note('b', 'B', 'see [[a]]'), // [[a]] tries to resolve to title "a" — a has no title
    ]
    const g = deriveGraph(notes)
    // a → b resolves (B has a title); b → a does NOT resolve (a is
    // untitled, so it cannot be a wikilink target).
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }])
  })
})

describe('snapshotSha', () => {
  test('changes when a note updatedAt changes', () => {
    const a = [note('x', 'X', 'body', 1)]
    const b = [note('x', 'X', 'body', 2)]
    expect(snapshotSha(a)).not.toBe(snapshotSha(b))
  })

  test('changes when a note id changes', () => {
    const a = [note('x', 'X', 'body', 1)]
    const b = [note('y', 'X', 'body', 1)]
    expect(snapshotSha(a)).not.toBe(snapshotSha(b))
  })

  test('stable across calls on the same input', () => {
    const arr = [note('x', 'X', 'b', 1), note('y', 'Y', 'c', 2)]
    expect(snapshotSha(arr)).toBe(snapshotSha(arr))
  })
})

describe('runForceSimulation', () => {
  test('returns one position per node with finite coordinates', () => {
    const nodes = [
      { id: 'a', title: 'A', degree: 1 },
      { id: 'b', title: 'B', degree: 1 },
      { id: 'c', title: 'C', degree: 0 },
    ]
    const edges = [{ source: 'a', target: 'b' }]
    const positions = runForceSimulation(nodes, edges, { iterations: 20 })
    expect(positions).toHaveLength(3)
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  test('deterministic for the same input', () => {
    const nodes = [
      { id: 'a', title: 'A', degree: 1 },
      { id: 'b', title: 'B', degree: 1 },
    ]
    const edges = [{ source: 'a', target: 'b' }]
    const a = runForceSimulation(nodes, edges, { iterations: 20 })
    const b = runForceSimulation(nodes, edges, { iterations: 20 })
    expect(a).toEqual(b)
  })

  test('positions stay inside the canvas margins', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      title: `N${i}`,
      degree: 1,
    }))
    const edges = []
    for (let i = 0; i < 29; i++) edges.push({ source: `n${i}`, target: `n${i + 1}` })
    const positions = runForceSimulation(nodes, edges, {
      width: 800,
      height: 600,
      iterations: 30,
    })
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(800)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(600)
    }
  })
})
