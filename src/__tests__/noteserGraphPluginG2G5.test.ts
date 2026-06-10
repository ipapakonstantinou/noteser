/**
 * noteserGraphPluginG2G5.test.ts
 *
 * Tests for the pure helpers added in the "G2-G5: interactive"
 * increment (v0.3.0) of `public/plugins/noteser-graph/main.js`:
 *   - click-vs-drag threshold logic (G5)
 *   - pinned-node `fixed`-flag handling in the live simulation step (G3)
 *   - hover neighbour-set computation (G4)
 *   - viewport persistence round-trip from `surface.transform` (G2)
 *
 * The plugin module is plain JS so TS infers loose types; each export
 * is re-cast to a test-facing signature for readability.
 */

import * as pluginModule from '../../public/plugins/noteser-graph/main.js'

interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fixed?: boolean
}
interface Edge {
  source: string
  target: string
}
interface Pt {
  x: number
  y: number
  t: number
}
interface Box {
  x: number
  y: number
  w: number
  h: number
}

const isTapGesture = pluginModule.isTapGesture as (
  start: Pt | null,
  end: Pt | null,
  opts?: { moveThreshold?: number; timeThreshold?: number },
) => boolean
const TAP_MOVE_THRESHOLD = pluginModule.TAP_MOVE_THRESHOLD as number
const TAP_TIME_THRESHOLD = pluginModule.TAP_TIME_THRESHOLD as number

const simulationStep = pluginModule.simulationStep as (
  sim: SimNode[],
  edges: ReadonlyArray<Edge>,
  opts?: { forces?: Record<string, number>; width?: number; height?: number },
) => SimNode[]
const simIsSettled = pluginModule.simIsSettled as (
  sim: ReadonlyArray<SimNode>,
  threshold?: number,
) => boolean

const hoverNeighbours = pluginModule.hoverNeighbours as (
  edges: ReadonlyArray<Edge>,
  hoveredId: string | null,
) => { nodes: Set<string>; edges: Set<string> }
const edgeKey = pluginModule.edgeKey as (source: string, target: string) => string

const viewportFromTransform = pluginModule.viewportFromTransform as (
  base: { w: number; h: number },
  transform: { x: number; y: number; scale: number },
) => Box
const clampViewport = pluginModule.clampViewport as (
  vp: Partial<Box> | null | undefined,
) => Box
const DEFAULT_VIEWPORT = pluginModule.DEFAULT_VIEWPORT as Box

// ─────────────────────────── click vs drag (G5) ────────────────────────────

describe('isTapGesture (G5 click-vs-drag)', () => {
  it('treats a still, quick press as a click', () => {
    expect(
      isTapGesture({ x: 10, y: 10, t: 0 }, { x: 12, y: 11, t: 120 }),
    ).toBe(true)
  })

  it('rejects a press that moves beyond the distance threshold', () => {
    expect(
      isTapGesture({ x: 10, y: 10, t: 0 }, { x: 40, y: 10, t: 100 }),
    ).toBe(false)
  })

  it('rejects a press that is held longer than the time threshold', () => {
    expect(
      isTapGesture({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 500 }),
    ).toBe(false)
  })

  it('accepts movement exactly at the distance threshold', () => {
    expect(
      isTapGesture(
        { x: 0, y: 0, t: 0 },
        { x: TAP_MOVE_THRESHOLD, y: 0, t: 10 },
      ),
    ).toBe(true)
  })

  it('accepts a hold exactly at the time threshold', () => {
    expect(
      isTapGesture({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: TAP_TIME_THRESHOLD }),
    ).toBe(true)
  })

  it('honours custom thresholds', () => {
    expect(
      isTapGesture({ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 10 }, {
        moveThreshold: 10,
      }),
    ).toBe(true)
    expect(
      isTapGesture({ x: 0, y: 0, t: 0 }, { x: 6, y: 0, t: 10 }, {
        moveThreshold: 2,
      }),
    ).toBe(false)
  })

  it('returns false when either endpoint is missing', () => {
    expect(isTapGesture(null, { x: 0, y: 0, t: 0 })).toBe(false)
    expect(isTapGesture({ x: 0, y: 0, t: 0 }, null)).toBe(false)
  })
})

// ───────────────────── pinned-node simulation step (G3) ─────────────────────

describe('simulationStep (G3 pinned-node handling)', () => {
  it('never moves a fixed node', () => {
    const sim: SimNode[] = [
      { id: 'a', x: 100, y: 100, vx: 0, vy: 0, fixed: true },
      { id: 'b', x: 110, y: 100, vx: 0, vy: 0 },
    ]
    simulationStep(sim, [], { forces: { repel: 1000 } })
    const a = sim.find((n) => n.id === 'a')!
    expect(a.x).toBe(100)
    expect(a.y).toBe(100)
    expect(a.vx).toBe(0)
    expect(a.vy).toBe(0)
  })

  it('moves an unpinned node and lets the fixed node still repel it', () => {
    const sim: SimNode[] = [
      { id: 'a', x: 100, y: 100, vx: 0, vy: 0, fixed: true },
      { id: 'b', x: 110, y: 100, vx: 0, vy: 0 },
    ]
    simulationStep(sim, [], { forces: { repel: 1000, center: 0 } })
    const b = sim.find((n) => n.id === 'b')!
    // The pinned node a repels b to the right (away from a at x=100).
    expect(b.x).toBeGreaterThan(110)
    expect(b.y).toBeCloseTo(100, 5)
  })

  it('reports settled only when every unpinned node is near rest', () => {
    const moving: SimNode[] = [{ id: 'a', x: 0, y: 0, vx: 5, vy: 0 }]
    expect(simIsSettled(moving)).toBe(false)
    const resting: SimNode[] = [{ id: 'a', x: 0, y: 0, vx: 0.01, vy: 0.01 }]
    expect(simIsSettled(resting)).toBe(true)
  })

  it('ignores fast-moving fixed nodes when deciding settledness', () => {
    // A fixed node carrying stale velocity must not keep the loop alive.
    const sim: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 99, vy: 99, fixed: true },
      { id: 'b', x: 0, y: 0, vx: 0, vy: 0 },
    ]
    expect(simIsSettled(sim)).toBe(true)
  })
})

// ───────────────────────── hover neighbour set (G4) ─────────────────────────

describe('hoverNeighbours (G4 hover highlight)', () => {
  const edges: Edge[] = [
    { source: 'a', target: 'b' },
    { source: 'c', target: 'a' },
    { source: 'b', target: 'd' },
  ]

  it('includes the hovered node and its 1-hop neighbours (undirected)', () => {
    const { nodes } = hoverNeighbours(edges, 'a')
    expect([...nodes].sort()).toEqual(['a', 'b', 'c'])
    // d is two hops away, so it is NOT a neighbour of a.
    expect(nodes.has('d')).toBe(false)
  })

  it('marks exactly the edges incident to the hovered node', () => {
    const { edges: incident } = hoverNeighbours(edges, 'a')
    expect(incident.has(edgeKey('a', 'b'))).toBe(true)
    expect(incident.has(edgeKey('c', 'a'))).toBe(true)
    // b->d does not touch a.
    expect(incident.has(edgeKey('b', 'd'))).toBe(false)
    expect(incident.size).toBe(2)
  })

  it('returns empty sets when nothing is hovered', () => {
    const { nodes, edges: incident } = hoverNeighbours(edges, null)
    expect(nodes.size).toBe(0)
    expect(incident.size).toBe(0)
  })

  it('keys incident edges in the original edge orientation', () => {
    // c->a is stored source=c, target=a; the key must match that order.
    const { edges: incident } = hoverNeighbours(edges, 'a')
    expect(incident.has(edgeKey('c', 'a'))).toBe(true)
    expect(incident.has(edgeKey('a', 'c'))).toBe(false)
  })
})

// ─────────────────────── viewport round-trip (G2) ──────────────────────────

describe('viewportFromTransform (G2 viewport persistence)', () => {
  const base = { w: DEFAULT_VIEWPORT.w, h: DEFAULT_VIEWPORT.h }

  it('round-trips a no-op settle (scale 1) back to the base box', () => {
    const vp = viewportFromTransform(base, { x: 0, y: 0, scale: 1 })
    expect(vp).toEqual({
      x: 0,
      y: 0,
      w: DEFAULT_VIEWPORT.w,
      h: DEFAULT_VIEWPORT.h,
    })
  })

  it('halves the box when zoomed in 2x and carries the pan offset', () => {
    const vp = viewportFromTransform(base, { x: 100, y: 50, scale: 2 })
    expect(vp.x).toBe(100)
    expect(vp.y).toBe(50)
    expect(vp.w).toBeCloseTo(DEFAULT_VIEWPORT.w / 2, 5)
    expect(vp.h).toBeCloseTo(DEFAULT_VIEWPORT.h / 2, 5)
  })

  it('grows the box when zoomed out (scale < 1)', () => {
    const vp = viewportFromTransform(base, { x: -10, y: -20, scale: 0.5 })
    expect(vp.w).toBeCloseTo(DEFAULT_VIEWPORT.w * 2, 5)
    expect(vp.h).toBeCloseTo(DEFAULT_VIEWPORT.h * 2, 5)
  })

  it('falls back to scale 1 on a non-finite / non-positive scale', () => {
    const vp = viewportFromTransform(base, {
      x: 0,
      y: 0,
      scale: Number.NaN,
    })
    expect(vp.w).toBe(DEFAULT_VIEWPORT.w)
    const vp2 = viewportFromTransform(base, { x: 0, y: 0, scale: 0 })
    expect(vp2.w).toBe(DEFAULT_VIEWPORT.w)
  })
})

describe('clampViewport (G2 sanitisation)', () => {
  it('defaults non-finite fields to the base viewport', () => {
    const vp = clampViewport({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      w: Number.NaN,
      h: undefined as unknown as number,
    })
    expect(vp.x).toBe(DEFAULT_VIEWPORT.x)
    expect(vp.y).toBe(DEFAULT_VIEWPORT.y)
    expect(vp.w).toBe(DEFAULT_VIEWPORT.w)
    expect(vp.h).toBe(DEFAULT_VIEWPORT.h)
  })

  it('clamps an absurdly small width up to the floor', () => {
    const vp = clampViewport({ x: 0, y: 0, w: 0.0001, h: 0.0001 })
    expect(vp.w).toBeGreaterThan(0)
    expect(vp.w).toBeCloseTo(DEFAULT_VIEWPORT.w / 50, 5)
  })

  it('passes a sane box through unchanged', () => {
    const vp = clampViewport({ x: 5, y: 6, w: 200, h: 150 })
    expect(vp).toEqual({ x: 5, y: 6, w: 200, h: 150 })
  })
})
