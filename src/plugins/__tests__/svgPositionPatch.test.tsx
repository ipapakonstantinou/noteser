/**
 * v1.3 (L4) — position-patch fast path.
 *
 * Covers:
 *   - sanitizeSvgPositionPatches drops malformed entries
 *   - applySvgPositionPatches mutates the mounted circle cx/cy and the
 *     edge endpoints WITHOUT remounting the React tree (same DOM element
 *     identity before/after)
 *   - the `worker:patchSvgPositions` envelope validates via
 *     isWorkerToHost and the host rejects an oversized batch + emits a
 *     clean svgPositionsPatch event for a valid one
 */

import { render } from '@testing-library/react'
import { PluginNode, type VNode } from '../PluginVNode'
import {
  sanitizeSvgPositionPatches,
  applySvgPositionPatches,
  NODE_ID_ATTR,
} from '../svgPositionPatch'
import { isWorkerToHost, MAX_ENVELOPE_BYTES, type WorkerToHost } from '../protocol'
import { PluginHost, type MinimalWorker, type PluginHostEvent } from '../PluginHost'
import type { PluginManifest } from '../manifest'

describe('sanitizeSvgPositionPatches', () => {
  test('keeps well-formed {id,x,y} and drops everything else', () => {
    const out = sanitizeSvgPositionPatches([
      { id: 'a', x: 1, y: 2 },
      { id: '', x: 1, y: 2 }, // empty id
      { id: 'b', x: NaN, y: 2 }, // non-finite
      { id: 'c', x: 3, y: Infinity }, // non-finite
      { id: 5, x: 1, y: 2 }, // non-string id
      'nope',
      null,
      { id: 'd', x: 9, y: 10 },
    ])
    expect(out).toEqual([
      { id: 'a', x: 1, y: 2 },
      { id: 'd', x: 9, y: 10 },
    ])
  })

  test('returns [] for a non-array', () => {
    expect(sanitizeSvgPositionPatches({})).toEqual([])
    expect(sanitizeSvgPositionPatches(undefined)).toEqual([])
  })
})

describe('applySvgPositionPatches — DOM mutation without re-render', () => {
  test('moves the circle and the connected edge endpoints, keeping element identity', () => {
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 200,
            height: 200,
            children: [
              { tag: 'line', x1: 0, y1: 0, x2: 50, y2: 50, sourceId: 'n1', targetId: 'n2' },
              { tag: 'circle', cx: 0, cy: 0, r: 4, id: 'n1' },
              { tag: 'circle', cx: 50, cy: 50, r: 4, id: 'n2' },
            ],
          } as VNode
        }
        onEvent={() => {}}
      />,
    )
    const circleBefore = container.querySelector(`[${NODE_ID_ATTR}="n1"]`)!
    const line = container.querySelector('line')!
    expect(circleBefore.getAttribute('cx')).toBe('0')

    const moved = applySvgPositionPatches(container, [
      { id: 'n1', x: 33, y: 44 },
      { id: 'n2', x: 99, y: 88 },
    ])
    expect(moved).toBe(2)

    // Same element instance — the React tree did NOT remount.
    const circleAfter = container.querySelector(`[${NODE_ID_ATTR}="n1"]`)!
    expect(circleAfter).toBe(circleBefore)

    expect(circleAfter.getAttribute('cx')).toBe('33')
    expect(circleAfter.getAttribute('cy')).toBe('44')
    // edge source endpoint follows n1, target endpoint follows n2.
    expect(line.getAttribute('x1')).toBe('33')
    expect(line.getAttribute('y1')).toBe('44')
    expect(line.getAttribute('x2')).toBe('99')
    expect(line.getAttribute('y2')).toBe('88')
  })

  test('no-op on null root or empty patches', () => {
    expect(applySvgPositionPatches(null, [{ id: 'a', x: 1, y: 1 }])).toBe(0)
    const div = document.createElement('div')
    expect(applySvgPositionPatches(div, [])).toBe(0)
  })
})

// ─── host envelope handling ────────────────────────────────────────────────

describe('worker:patchSvgPositions protocol', () => {
  test('isWorkerToHost accepts the envelope', () => {
    expect(
      isWorkerToHost({ type: 'worker:patchSvgPositions', seq: 1, patches: [] }),
    ).toBe(true)
  })
})

const manifest: PluginManifest = {
  id: 'graph',
  name: 'Graph',
  version: '1.0.0',
  surfaces: { fullscreenViews: [{ id: 'view', title: 'View', interaction: { pointer: true } }] },
}

function makeFakeWorker(): { worker: MinimalWorker; emit: (msg: unknown) => void } {
  let handler: ((event: MessageEvent) => void) | null = null
  const worker: MinimalWorker = {
    onmessage: null,
    postMessage(message: unknown) {
      const msg = message as WorkerToHost
      if ((msg as { type: string }).type === 'host:boot') {
        queueMicrotask(() => {
          handler?.({
            data: { type: 'worker:ready', seq: (msg as { seq: number }).seq, manifest },
          } as MessageEvent)
        })
      }
    },
    terminate() {
      handler = null
    },
  } as MinimalWorker
  Object.defineProperty(worker, 'onmessage', {
    configurable: true,
    get: () => handler,
    set: (v: ((event: MessageEvent) => void) | null) => {
      handler = v
    },
  })
  return { worker, emit: (msg) => handler?.({ data: msg } as MessageEvent) }
}

describe('PluginHost handles worker:patchSvgPositions', () => {
  test('emits a sanitized svgPositionsPatch event for a valid batch', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    const seen: PluginHostEvent[] = []
    host.on((e) => seen.push(e))
    await host.load({ pluginId: 'graph', pluginSource: '' })

    fake.emit({
      type: 'worker:patchSvgPositions',
      seq: 99,
      viewId: 'view',
      patches: [
        { id: 'n1', x: 1, y: 2 },
        { id: 'bad', x: 'nope', y: 2 },
        { id: 'n2', x: 3, y: 4 },
      ],
    })

    const patchEvents = seen.filter((e) => e.type === 'svgPositionsPatch')
    expect(patchEvents).toHaveLength(1)
    const ev = patchEvents[0] as Extract<PluginHostEvent, { type: 'svgPositionsPatch' }>
    expect(ev.pluginId).toBe('graph')
    expect(ev.viewId).toBe('view')
    expect(ev.patches).toEqual([
      { id: 'n1', x: 1, y: 2 },
      { id: 'n2', x: 3, y: 4 },
    ])
  })

  test('rejects an oversized batch (envelope guard) and emits no patch event', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    const seen: PluginHostEvent[] = []
    host.on((e) => seen.push(e))
    await host.load({ pluginId: 'graph', pluginSource: '' })

    // Build a batch whose JSON is well past MAX_ENVELOPE_BYTES.
    const patches: Array<{ id: string; x: number; y: number }> = []
    while (JSON.stringify(patches).length < MAX_ENVELOPE_BYTES + 1000) {
      patches.push({ id: `node-${patches.length}-xxxxxxxxxx`, x: 123.456, y: 789.012 })
    }
    fake.emit({ type: 'worker:patchSvgPositions', seq: 100, patches })

    expect(seen.some((e) => e.type === 'svgPositionsPatch')).toBe(false)
    const errs = seen.filter((e) => e.type === 'workerError') as Array<
      Extract<PluginHostEvent, { type: 'workerError' }>
    >
    expect(errs.length).toBeGreaterThan(0)
    expect(errs[errs.length - 1].message).toMatch(/Envelope too large/i)
  })
})
