// v1.3 (L4) — position-patch fast path: apply `{ id, x, y }` patches to
// the already-mounted SVG of an interactive plugin surface WITHOUT a
// full React re-render of the VNode tree.
//
// The curated renderer (`PluginVNode.tsx`) tags every opt-in SVG circle
// with `data-node-id` and every edge `line` with `data-edge-source` /
// `data-edge-target`. This module reads those attributes to build a
// host-side map from node id → DOM element(s) for the active surface,
// then mutates `cx`/`cy` on the circle and the matching endpoint
// (`x1`/`y1` for a source, `x2`/`y2` for a target) on each connected
// line. Direct attribute mutation bypasses React reconciliation, so a
// 500-node force-graph tick repaints at 60fps instead of re-serialising
// the whole tree each frame.
//
// Security: patches carry only `{ id, x, y }` — numbers plus an echoed
// id string. We never read or write style, class, or arbitrary
// attributes here, and we never call any selector with plugin-controlled
// strings (the map is built by walking `data-*` attributes, so a
// malicious id cannot inject a selector).

/** Data attribute the renderer stamps on an opt-in SVG circle so the
 *  patch path can address it by node id. */
export const NODE_ID_ATTR = 'data-node-id'
/** Data attribute on an edge `line` naming the node id its first
 *  endpoint (`x1`/`y1`) follows. */
export const EDGE_SOURCE_ATTR = 'data-edge-source'
/** Data attribute on an edge `line` naming the node id its second
 *  endpoint (`x2`/`y2`) follows. */
export const EDGE_TARGET_ATTR = 'data-edge-target'

export interface SvgPositionPatch {
  id: string
  x: number
  y: number
}

/**
 * Validate + normalise a raw patches payload off the wire. Returns only
 * the entries with a non-empty string id and finite numeric x/y; drops
 * everything else. Returns an empty array (never throws) when the input
 * is not an array, so a malformed envelope degrades to a no-op patch.
 */
export function sanitizeSvgPositionPatches(input: unknown): SvgPositionPatch[] {
  if (!Array.isArray(input)) return []
  const out: SvgPositionPatch[] = []
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as { id?: unknown; x?: unknown; y?: unknown }
    if (typeof r.id !== 'string' || r.id.length === 0) continue
    if (typeof r.x !== 'number' || !Number.isFinite(r.x)) continue
    if (typeof r.y !== 'number' || !Number.isFinite(r.y)) continue
    out.push({ id: r.id, x: r.x, y: r.y })
  }
  return out
}

/**
 * Apply position patches to the mounted SVG under `root`. Builds the
 * id → element map fresh from the current DOM each call, so it always
 * reflects the latest render (the map is "refreshed when the tree
 * re-renders" simply by being rebuilt on the next patch). Returns the
 * number of node circles that were actually moved.
 *
 * No-op when `root` is null or `patches` is empty.
 */
export function applySvgPositionPatches(
  root: Element | null | undefined,
  patches: ReadonlyArray<SvgPositionPatch>,
): number {
  if (!root || patches.length === 0) return 0

  // One pass over the DOM to index every addressable shape by id. Walking
  // attributes (not a selector built from the patch id) keeps a hostile
  // node id from escaping into a querySelector.
  const circles = new Map<string, Element>()
  for (const el of root.querySelectorAll(`[${NODE_ID_ATTR}]`)) {
    const id = el.getAttribute(NODE_ID_ATTR)
    if (id !== null) circles.set(id, el)
  }
  const sourceLines = groupLinesBy(root, EDGE_SOURCE_ATTR)
  const targetLines = groupLinesBy(root, EDGE_TARGET_ATTR)

  let moved = 0
  for (const p of patches) {
    const x = String(p.x)
    const y = String(p.y)
    const circle = circles.get(p.id)
    if (circle) {
      circle.setAttribute('cx', x)
      circle.setAttribute('cy', y)
      moved++
    }
    const sources = sourceLines.get(p.id)
    if (sources) {
      for (const line of sources) {
        line.setAttribute('x1', x)
        line.setAttribute('y1', y)
      }
    }
    const targets = targetLines.get(p.id)
    if (targets) {
      for (const line of targets) {
        line.setAttribute('x2', x)
        line.setAttribute('y2', y)
      }
    }
  }
  return moved
}

function groupLinesBy(root: Element, attr: string): Map<string, Element[]> {
  const map = new Map<string, Element[]>()
  for (const el of root.querySelectorAll(`[${attr}]`)) {
    const id = el.getAttribute(attr)
    if (id === null) continue
    const bucket = map.get(id)
    if (bucket) bucket.push(el)
    else map.set(id, [el])
  }
  return map
}
