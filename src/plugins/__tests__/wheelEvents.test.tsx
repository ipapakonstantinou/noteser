/**
 * v1.3 (L2 + L3) — wheel + hover events on the curated VNode renderer.
 *
 * Covers:
 *   - onWheel dispatches a WheelEventPayload (deltas + focal coords +
 *     ctrlKey) with coords mapped to the surface space, flagged
 *     high-frequency with interaction kind 'wheel'
 *   - onPointerEnter / onPointerLeave dispatch a HoverEventPayload with
 *     the echoed target id + mapped coords, flagged high-frequency with
 *     interaction kind 'hover'
 *   - the wheel listener is non-passive (preventDefault is honoured) so
 *     page scroll is stopped on an interactive surface
 *   - a surface with no wheel handler attaches no wheel listener
 */

import { render, fireEvent } from '@testing-library/react'
import { PluginNode, type PluginVNodeEvent, type VNode } from '../PluginVNode'

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

// translate(10,20): user = client - (10,20).
function stubScreenCTM(el: Element, m = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }): void {
  ;(el as unknown as { getScreenCTM: () => typeof m }).getScreenCTM = () => m
}

describe('svg onWheel dispatch (L2)', () => {
  test('wheel payload carries deltas, mapped focal coords, ctrlKey, and the wheel HF flag', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 100,
            height: 100,
            id: 'surface',
            onWheel: { kind: 'emit', event: 'zoom', payload: { src: 'plugin' } },
            children: [],
          } as VNode
        }
        onEvent={(e) => events.push(e)}
      />,
    )
    const svg = container.querySelector('svg')!
    stubScreenCTM(svg)
    fireEvent.wheel(svg, { deltaX: 3, deltaY: -12, clientX: 60, clientY: 70, ctrlKey: true })

    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('zoom')
    expect(events[0].highFrequency).toBe(true)
    expect(events[0].interaction).toBe('wheel')
    // host keys win the merge; plugin payload { src } preserved.
    expect(events[0].payload).toEqual({
      src: 'plugin',
      deltaX: 3,
      deltaY: -12,
      x: 50,
      y: 50,
      ctrlKey: true,
    })
  })

  test('wheel listener is non-passive — preventDefault stops page scroll', () => {
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'svg',
            width: 100,
            height: 100,
            onWheel: { kind: 'emit', event: 'zoom' },
            children: [],
          } as VNode
        }
        onEvent={() => {}}
      />,
    )
    const svg = container.querySelector('svg')!
    stubScreenCTM(svg)
    const evt = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true })
    svg.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })

  test('an svg with no wheel handler does not preventDefault (no listener attached)', () => {
    const { container } = render(
      <PluginNode
        node={{ tag: 'svg', width: 100, height: 100, children: [] } as VNode}
        onEvent={() => {}}
      />,
    )
    const svg = container.querySelector('svg')!
    const evt = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true })
    svg.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })
})

describe('box onWheel dispatch (L2)', () => {
  test('box wheel maps focal coords to element-local pixels and flags wheel HF', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={
          {
            tag: 'box',
            id: 'panel',
            onWheel: { kind: 'emit', event: 'scroll' },
            children: [{ tag: 'text', value: 'hi' }],
          } as VNode
        }
        onEvent={(e) => events.push(e)}
      />,
    )
    const box = container.querySelector('div')!
    box.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 0, bottom: 0, width: 0, height: 0, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect
    fireEvent.wheel(box, { deltaX: 0, deltaY: 5, clientX: 130, clientY: 250, ctrlKey: false })

    expect(events).toHaveLength(1)
    expect(events[0].interaction).toBe('wheel')
    expect(events[0].payload).toEqual({ deltaX: 0, deltaY: 5, x: 30, y: 50, ctrlKey: false })
  })
})

describe('hover enter/leave dispatch (L3)', () => {
  function renderHoverCircle() {
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
                id: 'n1',
                onPointerEnter: { kind: 'emit', event: 'hover-in' },
                onPointerLeave: { kind: 'emit', event: 'hover-out' },
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

  test('pointerenter emits a HoverEventPayload flagged hover HF', () => {
    const { events, circle } = renderHoverCircle()
    fireEvent.pointerEnter(circle, { clientX: 60, clientY: 70 })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('hover-in')
    expect(events[0].highFrequency).toBe(true)
    expect(events[0].interaction).toBe('hover')
    expect(events[0].payload).toEqual({ target: 'n1', x: 50, y: 50 })
  })

  test('pointerleave emits a HoverEventPayload', () => {
    const { events, circle } = renderHoverCircle()
    fireEvent.pointerLeave(circle, { clientX: 110, clientY: 120 })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('hover-out')
    expect(events[0].payload).toEqual({ target: 'n1', x: 100, y: 100 })
  })
})
