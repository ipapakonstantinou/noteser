/**
 * v1.3 (L1) — pointer events on the curated VNode renderer.
 *
 * Covers:
 *   - coordinate mapping helpers (inverse screen CTM for svg, local
 *     pixels for box)
 *   - renderer attaches pointer listeners ONLY when the handler prop is
 *     present (absence = v1.2 behaviour, zero cost)
 *   - dispatched payload is the host-controlled PointerEventPayload
 *     shallow-merged over the plugin payload (host keys win)
 *   - the high-frequency flag rides only on pointermove
 *   - pointer capture fires on pointerdown when both down+move present
 *   - manifest validator accepts/rejects the `interaction` opt-in
 *   - end-to-end: render → surface dispatcher → PluginHost → worker
 */

import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import {
  PluginNode,
  renderPluginVNode,
  inverseCTMPoint,
  mapBoxPoint,
  type PluginVNodeEvent,
  type VNode,
} from '../PluginVNode'
import { validateManifest } from '../manifest'
import { PluginHost, type MinimalWorker } from '../PluginHost'
import type { HostToWorker, HostVNodeEvent, WorkerToHost } from '../protocol'
import type { PluginManifest } from '../manifest'

// jsdom does not ship PointerEvent; testing-library then loses clientX /
// pointerId / button. Polyfill a MouseEvent-backed PointerEvent that
// carries pointerId so fireEvent.pointer* reflects the init.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  ;(globalThis as { PointerEvent?: unknown }).PointerEvent =
    PointerEventPolyfill as unknown as typeof PointerEvent
}

// jsdom does not implement getScreenCTM; install a fake matrix so the
// svg coordinate path is exercised deterministically. translate(10,20),
// no scale: user = client - (10,20).
function stubScreenCTM(el: Element, m = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }): void {
  ;(el as unknown as { getScreenCTM: () => typeof m }).getScreenCTM = () => m
}

describe('coordinate mapping helpers', () => {
  test('inverseCTMPoint inverts a translate+scale matrix', () => {
    // screen = 2*user + 10  ⇒ user = (screen-10)/2
    expect(inverseCTMPoint({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }, 30, 40)).toEqual({
      x: 10,
      y: 10,
    })
  })

  test('inverseCTMPoint returns the raw point on a degenerate matrix', () => {
    expect(inverseCTMPoint({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 5, 7)).toEqual({ x: 5, y: 7 })
  })

  test('mapBoxPoint subtracts the bounding-rect origin', () => {
    expect(mapBoxPoint({ left: 100, top: 50 }, 130, 90)).toEqual({ x: 30, y: 40 })
  })
})

describe('renderer attaches listeners only when handler props present', () => {
  test('a circle with no pointer handlers dispatches nothing on pointer events', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={{ tag: 'svg', width: 100, height: 100, children: [{ tag: 'circle', cx: 5, cy: 5, r: 3 }] }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const circle = container.querySelector('circle')!
    stubScreenCTM(circle)
    fireEvent.pointerDown(circle, { clientX: 50, clientY: 60, pointerId: 1, button: 0 })
    fireEvent.pointerMove(circle, { clientX: 51, clientY: 61, pointerId: 1 })
    fireEvent.pointerUp(circle, { clientX: 51, clientY: 61, pointerId: 1, button: 0 })
    expect(events).toEqual([])
  })

  test('a no-interaction VNode tree (only v1.2 shapes) renders unchanged', () => {
    // A button has no pointer props; rendering must not throw and must
    // still fire its click event verbatim.
    const events: PluginVNodeEvent[] = []
    const { getByRole } = render(
      <PluginNode
        node={{ tag: 'button', label: 'Go', onClick: { kind: 'emit', event: 'go' } }}
        onEvent={(e) => events.push(e)}
      />,
    )
    fireEvent.click(getByRole('button', { name: 'Go' }))
    expect(events).toEqual([{ event: 'go', payload: undefined }])
  })
})

describe('svg circle pointer dispatch', () => {
  function renderCircle(extra: Partial<Record<string, unknown>> = {}) {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 100,
            height: 100,
            children: [
              {
                tag: 'circle',
                cx: 5,
                cy: 5,
                r: 3,
                id: 'node-7',
                onPointerDown: { kind: 'emit', event: 'pdown' },
                onPointerMove: { kind: 'emit', event: 'pmove', payload: { tag: 'drag' } },
                onPointerUp: { kind: 'emit', event: 'pup' },
                ...extra,
              },
            ],
          } as VNode
        }
        onEvent={(e) => events.push(e)}
      />,
    )
    const circle = container.querySelector('circle')!
    stubScreenCTM(circle)
    return { events, circle }
  }

  test('pointerdown maps coords to user space and echoes the target id', () => {
    const { events, circle } = renderCircle()
    fireEvent.pointerDown(circle, { clientX: 60, clientY: 70, pointerId: 4, button: 0 })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      event: 'pdown',
      payload: { x: 50, y: 50, button: 0, pointerId: 4, target: 'node-7' },
    })
    // discrete event — no HF flag
    expect(events[0].highFrequency).toBeUndefined()
  })

  test('pointermove is flagged high-frequency, forces button -1, and host keys win the merge', () => {
    const { events, circle } = renderCircle()
    fireEvent.pointerMove(circle, { clientX: 110, clientY: 120, pointerId: 4, button: 0 })
    expect(events).toHaveLength(1)
    expect(events[0].highFrequency).toBe(true)
    // plugin payload { tag: 'drag' } is preserved; host keys override.
    expect(events[0].payload).toEqual({
      tag: 'drag',
      x: 100,
      y: 100,
      button: -1,
      pointerId: 4,
      target: 'node-7',
    })
  })

  test('pointerup is discrete and carries the real button', () => {
    const { events, circle } = renderCircle()
    fireEvent.pointerUp(circle, { clientX: 10, clientY: 20, pointerId: 4, button: 2 })
    expect(events[0]).toEqual({
      event: 'pup',
      payload: { x: 0, y: 0, button: 2, pointerId: 4, target: 'node-7' },
    })
  })

  test('target is null when the shape declared no id', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 100,
            height: 100,
            children: [
              { tag: 'circle', cx: 5, cy: 5, r: 3, onPointerDown: { kind: 'emit', event: 'pd' } },
            ],
          } as VNode
        }
        onEvent={(e) => events.push(e)}
      />,
    )
    const circle = container.querySelector('circle')!
    stubScreenCTM(circle)
    fireEvent.pointerDown(circle, { clientX: 10, clientY: 20, pointerId: 1, button: 0 })
    expect((events[0].payload as { target: string | null }).target).toBeNull()
  })

  test('setPointerCapture is called on pointerdown when both down and move are present', () => {
    const { circle } = renderCircle()
    const captured: number[] = []
    ;(circle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) =>
      captured.push(id)
    fireEvent.pointerDown(circle, { clientX: 10, clientY: 20, pointerId: 9, button: 0 })
    expect(captured).toEqual([9])
  })

  test('setPointerCapture is NOT called when only pointerdown is present', () => {
    const { circle } = renderCircle({ onPointerMove: undefined, onPointerUp: undefined })
    const captured: number[] = []
    ;(circle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) =>
      captured.push(id)
    fireEvent.pointerDown(circle, { clientX: 10, clientY: 20, pointerId: 9, button: 0 })
    expect(captured).toEqual([])
  })
})

describe('box pointer dispatch uses element-local pixels', () => {
  test('pointerdown on a box maps client coords relative to bounding rect', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'box',
            id: 'panel',
            onPointerDown: { kind: 'emit', event: 'bdown' },
            children: [{ tag: 'text', value: 'hi' }],
          } as VNode
        }
        onEvent={(e) => events.push(e)}
      />,
    )
    const box = container.querySelector('div')!
    box.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 0, bottom: 0, width: 0, height: 0, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(box, { clientX: 130, clientY: 250, pointerId: 1, button: 0 })
    expect(events[0]).toEqual({
      event: 'bdown',
      payload: { x: 30, y: 50, button: 0, pointerId: 1, target: 'panel' },
    })
  })
})

describe('renderPluginVNode without onEvent drops pointer events safely', () => {
  test('no onEvent: rendering a pointer-handler circle does not throw on a fire', () => {
    const node = renderPluginVNode({
      tag: 'svg',
      width: 10,
      height: 10,
      children: [{ tag: 'circle', cx: 1, cy: 1, r: 1, onPointerDown: { kind: 'emit', event: 'x' } }],
    })
    expect(node).not.toBeNull()
  })
})

describe('manifest interaction opt-in validation', () => {
  const base = {
    id: 'graph',
    name: 'Graph',
    version: '1.0.0',
    surfaces: { fullscreenViews: [{ id: 'view', title: 'View' }] },
  }

  test('accepts interaction { pointer: true } on a fullscreen view', () => {
    const r = validateManifest({
      ...base,
      surfaces: { fullscreenViews: [{ id: 'view', title: 'View', interaction: { pointer: true } }] },
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.surfaces.fullscreenViews?.[0].interaction).toEqual({ pointer: true })
  })

  test('accepts interaction on a sidebar panel with all three flags', () => {
    const r = validateManifest({
      ...base,
      surfaces: {
        sidebarPanels: [
          { id: 'panel', title: 'P', interaction: { pointer: true, wheel: false, hover: true } },
        ],
      },
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.surfaces.sidebarPanels?.[0].interaction).toEqual({
      pointer: true,
      wheel: false,
      hover: true,
    })
  })

  test('rejects an unknown interaction sub-key', () => {
    const r = validateManifest({
      ...base,
      surfaces: { fullscreenViews: [{ id: 'view', title: 'View', interaction: { drag: true } }] },
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /unknown key "drag"/i.test(e))).toBe(true)
  })

  test('rejects a non-boolean interaction flag', () => {
    const r = validateManifest({
      ...base,
      surfaces: { fullscreenViews: [{ id: 'view', title: 'View', interaction: { pointer: 'yes' } }] },
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /interaction\.pointer must be a boolean/i.test(e))).toBe(true)
  })

  test('rejects a non-object interaction value', () => {
    const r = validateManifest({
      ...base,
      surfaces: { fullscreenViews: [{ id: 'view', title: 'View', interaction: true }] },
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /interaction must be an object/i.test(e))).toBe(true)
  })

  test('omits interaction from the normalised manifest when not declared', () => {
    const r = validateManifest(base)
    expect(r.ok).toBe(true)
    expect(r.manifest?.surfaces.fullscreenViews?.[0].interaction).toBeUndefined()
  })
})

// ─── End-to-end: render → surface dispatcher → host → worker ────────────────

const e2eManifest: PluginManifest = {
  id: 'graph',
  name: 'Graph',
  version: '1.0.0',
  surfaces: {
    fullscreenViews: [{ id: 'view', title: 'View', interaction: { pointer: true } }],
  },
}

function makeFakeWorker(): { worker: MinimalWorker; sent: HostToWorker[] } {
  const sent: HostToWorker[] = []
  let handler: ((event: MessageEvent) => void) | null = null
  const worker: MinimalWorker = {
    onmessage: null,
    postMessage(message: unknown) {
      sent.push(message as HostToWorker)
      const msg = message as HostToWorker
      if (msg.type === 'host:boot') {
        queueMicrotask(() => {
          handler?.({
            data: { type: 'worker:ready', seq: msg.seq, manifest: e2eManifest } satisfies WorkerToHost,
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
  return { worker, sent }
}

describe('e2e — circle pointer events reach the worker with augmented payloads', () => {
  test('pointerdown/move/up flow through the host (move coalesced) with mapped coords + target', async () => {
    const fake = makeFakeWorker()
    const frames: Array<() => void> = []
    const host = new PluginHost({
      createWorker: () => fake.worker,
      requestFrame: (cb) => frames.push(cb),
    })
    await host.load({ pluginId: 'graph', pluginSource: '' })

    // Mimic PluginFullscreenView.handleEvent: forward the renderer event
    // into the host with the fullscreen source + the HF flag.
    const onEvent = (e: PluginVNodeEvent) =>
      host.sendVNodeEvent('graph', { kind: 'fullscreen', viewId: 'view' }, e.event, e.payload, {
        highFrequency: e.highFrequency === true,
      })

    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 100,
            height: 100,
            children: [
              {
                tag: 'circle',
                cx: 5,
                cy: 5,
                r: 3,
                id: 'n1',
                onPointerDown: { kind: 'emit', event: 'pdown' },
                onPointerMove: { kind: 'emit', event: 'pmove' },
                onPointerUp: { kind: 'emit', event: 'pup' },
              },
            ],
          } as VNode
        }
        onEvent={onEvent}
      />,
    )
    const circle = container.querySelector('circle')!
    stubScreenCTM(circle)

    fireEvent.pointerDown(circle, { clientX: 60, clientY: 70, pointerId: 2, button: 0 })
    fireEvent.pointerMove(circle, { clientX: 80, clientY: 90, pointerId: 2 })
    fireEvent.pointerMove(circle, { clientX: 110, clientY: 120, pointerId: 2 })
    fireEvent.pointerUp(circle, { clientX: 110, clientY: 120, pointerId: 2, button: 0 })

    // Discrete events delivered immediately; the move is still pending a frame.
    const delivered = () =>
      fake.sent.filter((m): m is HostVNodeEvent => m.type === 'host:vnodeEvent')
    expect(delivered().map((m) => m.event)).toEqual(['pdown', 'pup'])

    frames.forEach((f) => f())
    const all = delivered()
    expect(all.map((m) => m.event)).toEqual(['pdown', 'pup', 'pmove'])

    const down = all.find((m) => m.event === 'pdown')!
    expect(down.payload).toEqual({ x: 50, y: 50, button: 0, pointerId: 2, target: 'n1' })
    expect(down.source).toEqual({ kind: 'fullscreen', viewId: 'view' })

    // Coalesced to the LATEST move only.
    const move = all.find((m) => m.event === 'pmove')!
    expect(move.payload).toEqual({ x: 100, y: 100, button: -1, pointerId: 2, target: 'n1' })
  })
})
