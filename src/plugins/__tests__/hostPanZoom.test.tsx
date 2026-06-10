/**
 * v1.3 (L2) — host-owned pan/zoom (`VNodeSvg.panZoom: 'host'`).
 *
 * The host owns the viewBox transform locally: a drag-pan or wheel-zoom
 * mutates the rendered `<svg>` viewBox with NO worker round-trip, and on
 * gesture settle (pointerup, or a wheel-idle debounce) it emits exactly
 * ONE `surface.transform` event carrying the final `{ x, y, scale }`.
 */

import { render, fireEvent, act } from '@testing-library/react'
import { PluginNode, type PluginVNodeEvent, type VNode } from '../PluginVNode'
import { SURFACE_TRANSFORM_EVENT } from '../protocol'

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

function renderPanZoom() {
  const events: PluginVNodeEvent[] = []
  const { container } = render(
    <PluginNode
      node={
        {
          tag: 'svg',
          width: 200,
          height: 100,
          viewBox: [0, 0, 200, 100],
          panZoom: 'host',
          children: [{ tag: 'circle', cx: 10, cy: 10, r: 4, id: 'n1' }],
        } as VNode
      }
      onEvent={(e) => events.push(e)}
    />,
  )
  const svg = container.querySelector('svg')!
  return { events, svg }
}

const transforms = (events: PluginVNodeEvent[]) =>
  events.filter((e) => e.event === SURFACE_TRANSFORM_EVENT)

describe('host-owned pan', () => {
  test('drag pans the viewBox locally and emits ONE surface.transform on pointerup', () => {
    const { events, svg } = renderPanZoom()

    // jsdom reports clientWidth/Height 0; the surface falls back to the
    // declared width/height, so 1 user-unit per pixel here.
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 10, pointerId: 1 })

    // No settle event mid-drag, but the viewBox already moved locally.
    expect(transforms(events)).toHaveLength(0)
    expect(svg.getAttribute('viewBox')).toBe('-20 0 200 100')

    fireEvent.pointerUp(svg, { clientX: 30, clientY: 10, pointerId: 1, button: 0 })
    const settled = transforms(events)
    expect(settled).toHaveLength(1)
    expect(settled[0].payload).toEqual({ x: -20, y: 0, scale: 1 })
    // settle events are discrete, never high-frequency.
    expect(settled[0].highFrequency).toBeUndefined()
  })

  test('a pan starting on a child shape does not pan the surface', () => {
    const { events, svg } = renderPanZoom()
    const circle = svg.querySelector('circle')!
    // target !== currentTarget (originates on the circle) → ignored.
    fireEvent.pointerDown(svg, { target: circle, clientX: 10, clientY: 10, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 50, clientY: 10, pointerId: 1, button: 0 })
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(transforms(events)).toHaveLength(0)
  })
})

describe('host-owned wheel zoom', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  test('wheel zoom updates the viewBox locally and emits ONE transform after the idle debounce', () => {
    const { events, svg } = renderPanZoom()
    const before = svg.getAttribute('viewBox')

    // Several notches in one burst — page scroll prevented, viewBox
    // shrinks (zoom in), but no settle event yet.
    act(() => {
      fireEvent.wheel(svg, { deltaY: -100, clientX: 0, clientY: 0 })
      fireEvent.wheel(svg, { deltaY: -100, clientX: 0, clientY: 0 })
    })
    expect(transforms(events)).toHaveLength(0)
    const after = svg.getAttribute('viewBox')
    expect(after).not.toBe(before)

    // After the wheel goes idle, exactly one settle event fires.
    act(() => {
      jest.advanceTimersByTime(150)
    })
    const settled = transforms(events)
    expect(settled).toHaveLength(1)
    const payload = settled[0].payload as { x: number; y: number; scale: number }
    // deltaY < 0 zooms IN → scale > 1.
    expect(payload.scale).toBeGreaterThan(1)
  })

  test('wheel is non-passive — page scroll is prevented', () => {
    const { svg } = renderPanZoom()
    const evt = new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true })
    act(() => {
      svg.dispatchEvent(evt)
    })
    expect(evt.defaultPrevented).toBe(true)
  })
})
