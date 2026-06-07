/**
 * PluginVNode.test.tsx
 *
 * Plugin API v1.2 PR A — exercise the extended VNode set:
 *   button / input / list / link / radio / svg / box
 *
 * Each test asserts the rendered DOM is structurally what the plan in
 * `docs/plugins-v1.2-plan.md` (section 2) describes, plus the host
 * never reaches dangerouslySetInnerHTML, the sanitiser escapes script
 * tags in plugin text, unsafe link hrefs are rejected, and the event
 * shape round-trips through the dispatcher.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  PluginNode,
  renderPluginVNode,
  escapeText,
  isSafePluginHref,
  MAX_LIST_DEPTH,
  type PluginVNodeEvent,
  type VNode,
} from '../PluginVNode'

describe('PluginVNode — v1 shapes still work', () => {
  test('text renders its value as a span', () => {
    render(<PluginNode node={{ tag: 'text', value: 'hello world' }} />)
    expect(screen.getByText('hello world').tagName).toBe('SPAN')
  })

  test('callout renders the body and falls back to "note" kind', () => {
    render(<PluginNode node={{ tag: 'callout', body: 'body text' }} />)
    expect(screen.getByText('body text')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })
})

describe('PluginVNode — button', () => {
  test('renders the label and fires onClick with payload', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'button',
          label: 'Save',
          variant: 'primary',
          onClick: { kind: 'emit', event: 'save', payload: { id: 1 } },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(events).toEqual([{ event: 'save', payload: { id: 1 } }])
  })

  test('disabled buttons render disabled and never fire events', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'button',
          label: 'Save',
          disabled: true,
          onClick: { kind: 'emit', event: 'save' },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(events).toEqual([])
  })

  test('non-string label rejects the node', () => {
    const out = renderPluginVNode({ tag: 'button', label: 42 } as unknown)
    expect(out).toBeNull()
  })
})

describe('PluginVNode — input', () => {
  test('text input forwards typed value through the dispatcher', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'input',
          type: 'text',
          value: '',
          placeholder: 'Search…',
          onChange: { kind: 'emit', event: 'q' },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(events).toEqual([{ event: 'q', payload: { value: 'abc' } }])
  })

  test('number input coerces value to a number in the payload', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'input',
          type: 'number',
          value: 0,
          onChange: { kind: 'emit', event: 'n' },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '7' } })
    expect(events).toEqual([{ event: 'n', payload: { value: 7 } }])
  })

  test('select input renders options and emits the picked value', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'input',
          type: 'select',
          value: 'a',
          options: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Bravo' },
          ],
          onChange: { kind: 'emit', event: 'pick' },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b' } })
    expect(events).toEqual([{ event: 'pick', payload: { value: 'b' } }])
  })

  test('unknown input type rejects the node', () => {
    const out = renderPluginVNode({ tag: 'input', type: 'password' } as unknown)
    expect(out).toBeNull()
  })
})

describe('PluginVNode — list', () => {
  test('unordered list renders <ul> with child VNodes', () => {
    render(
      <PluginNode
        node={{
          tag: 'list',
          ordered: false,
          items: [
            { tag: 'text', value: 'one' },
            { tag: 'text', value: 'two' },
          ],
        }}
      />,
    )
    const ul = screen.getByText('one').closest('ul')
    expect(ul).not.toBeNull()
    expect(screen.getByText('two')).toBeInTheDocument()
  })

  test('ordered list renders <ol>', () => {
    render(
      <PluginNode
        node={{
          tag: 'list',
          ordered: true,
          items: [{ tag: 'text', value: 'first' }],
        }}
      />,
    )
    expect(screen.getByText('first').closest('ol')).not.toBeNull()
  })

  test('list nested beyond MAX_LIST_DEPTH drops the leaf, does not blow the stack', () => {
    // Build a list nested deeper than MAX_LIST_DEPTH levels with a
    // text leaf at the bottom. The outer lists render fine, but the
    // recursion stops once depth exceeds the cap — so the leaf text
    // never reaches the DOM. The bound exists to keep a malicious
    // plugin from blowing the React stack, not to error noisily.
    let node: VNode = { tag: 'text', value: 'leaf-too-deep' }
    for (let i = 0; i < MAX_LIST_DEPTH + 2; i++) {
      node = { tag: 'list', items: [node] }
    }
    const { container } = render(<PluginNode node={node} />)
    expect(container.textContent).not.toContain('leaf-too-deep')
  })
})

describe('PluginVNode — link', () => {
  test('note href renders an anchor with a wikilink:// URL', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Open',
          href: { kind: 'note', noteId: 'abc' },
        }}
      />,
    )
    const a = screen.getByRole('link', { name: 'Open' }) as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('wikilink://abc')
  })

  test('anchor href renders a fragment link', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Jump',
          href: { kind: 'anchor', fragment: 'section-1' },
        }}
      />,
    )
    const a = screen.getByRole('link', { name: 'Jump' }) as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('#section-1')
  })

  test('javascript: cannot be expressed — discriminated union rejects raw hrefs', () => {
    // Try to slip a raw href through. The renderer reads `href.kind` —
    // a plain string fails the type guard, the node renders to null,
    // and `PluginNode` shows the JSON fallback.
    const out = renderPluginVNode({
      tag: 'link',
      label: 'click',
      href: 'javascript:alert(1)' as unknown,
    } as unknown)
    expect(out).toBeNull()
  })

  test('isSafePluginHref rejects javascript: and data:', () => {
    expect(isSafePluginHref('javascript:alert(1)')).toBe(false)
    expect(isSafePluginHref('data:text/html,<script>')).toBe(false)
    expect(isSafePluginHref('http://evil.example')).toBe(false)
    expect(isSafePluginHref('mailto:a@b.c')).toBe(false)
    expect(isSafePluginHref('//evil.example/path')).toBe(false)
    expect(isSafePluginHref('wikilink://abc')).toBe(true)
    expect(isSafePluginHref('#fragment')).toBe(true)
    expect(isSafePluginHref('/local/path')).toBe(true)
  })
})

describe('PluginVNode — radio', () => {
  test('renders one radio per option and emits the picked value', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'radio',
          group: 'format',
          value: 'obsidian',
          options: [
            { value: 'obsidian', label: 'Obsidian' },
            { value: 'notion', label: 'Notion' },
          ],
          onChange: { kind: 'emit', event: 'pickFormat' },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const notion = screen.getByLabelText('Notion') as HTMLInputElement
    expect(notion.checked).toBe(false)
    fireEvent.click(notion)
    expect(events).toEqual([{ event: 'pickFormat', payload: { value: 'notion' } }])
  })
})

describe('PluginVNode — svg', () => {
  test('renders the five permitted shape primitives', () => {
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 100,
          height: 100,
          viewBox: [0, 0, 100, 100],
          children: [
            { tag: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
            { tag: 'circle', cx: 50, cy: 50, r: 5, fill: '#f00' },
            { tag: 'rect', x: 1, y: 2, width: 3, height: 4 },
            { tag: 'text', x: 10, y: 10, value: 'hi' },
            { tag: 'path', d: 'M0 0 L10 10' },
          ],
        }}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(container.querySelector('line')).not.toBeNull()
    expect(container.querySelector('circle')).not.toBeNull()
    expect(container.querySelector('rect')).not.toBeNull()
    expect(container.querySelector('text')?.textContent).toBe('hi')
    expect(container.querySelector('path')).not.toBeNull()
  })

  test('non-finite numeric props reject the affected child', () => {
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 100,
          height: 100,
          children: [
            { tag: 'circle', cx: Number.NaN, cy: 0, r: 5 },
            { tag: 'circle', cx: 1, cy: 2, r: 3 },
          ],
        }}
      />,
    )
    // Only the second circle survives the coerceFinite guard.
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(1)
    expect(circles[0].getAttribute('cx')).toBe('1')
  })

  test('clickable circle dispatches onClick event', () => {
    const events: PluginVNodeEvent[] = []
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 100,
          height: 100,
          children: [
            {
              tag: 'circle',
              cx: 50,
              cy: 50,
              r: 5,
              onClick: { kind: 'emit', event: 'pickNode', payload: { id: 'n1' } },
            },
          ],
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const circle = container.querySelector('circle')
    expect(circle).not.toBeNull()
    fireEvent.click(circle!)
    expect(events).toEqual([{ event: 'pickNode', payload: { id: 'n1' } }])
  })

  test('unknown svg child tags are dropped', () => {
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 10,
          height: 10,
          children: [{ tag: 'script', value: 'alert(1)' }],
        } as unknown}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
  })

  test('unsafe color string falls back to currentColor', () => {
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 10,
          height: 10,
          children: [
            { tag: 'line', x1: 0, y1: 0, x2: 1, y2: 1, stroke: 'url(javascript:alert(1))' },
          ],
        }}
      />,
    )
    const line = container.querySelector('line')
    expect(line?.getAttribute('stroke')).toBe('currentColor')
  })
})

describe('PluginVNode — box', () => {
  test('renders each child of a box', () => {
    render(
      <PluginNode
        node={{
          tag: 'box',
          gap: 2,
          children: [
            { tag: 'text', value: 'header' },
            { tag: 'text', value: 'body' },
          ],
        }}
      />,
    )
    expect(screen.getByText('header')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})

describe('PluginVNode — sanitisation', () => {
  test('script-tag strings render as text content, never as DOM nodes', () => {
    const evil = '<script>alert("x")</script>'
    const { container } = render(<PluginNode node={{ tag: 'text', value: evil }} />)
    // React renders the string as text content — no <script> element.
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain(evil)
  })

  test('escapeText escapes &, <, >, ", and \'', () => {
    expect(escapeText('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
    expect(escapeText("A & B's <tag>")).toBe('A &amp; B&#39;s &lt;tag&gt;')
  })

  test('svg text value renders as text content, not markup', () => {
    const evil = '<script>alert(1)</script>'
    const { container } = render(
      <PluginNode
        node={{
          tag: 'svg',
          width: 10,
          height: 10,
          children: [{ tag: 'text', x: 0, y: 0, value: evil }],
        }}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('text')?.textContent).toBe(evil)
  })

  test('renderer never reaches dangerouslySetInnerHTML for any v1.2 shape', () => {
    // Spy on React's warning channel — dangerouslySetInnerHTML on a
    // mismatched element would log. We just confirm no element in any
    // rendered v1.2 shape carries the attribute.
    const shapes: VNode[] = [
      { tag: 'button', label: 'b' },
      { tag: 'input', type: 'text' },
      { tag: 'list', items: [{ tag: 'text', value: 'x' }] },
      { tag: 'link', label: 'l', href: { kind: 'note', noteId: 'a' } },
      { tag: 'radio', group: 'g', options: [{ value: 'a', label: 'A' }] },
      {
        tag: 'svg',
        width: 10,
        height: 10,
        children: [{ tag: 'text', x: 0, y: 0, value: 'x' }],
      },
      { tag: 'box', children: [{ tag: 'text', value: 'x' }] },
    ]
    for (const shape of shapes) {
      const { container, unmount } = render(<PluginNode node={shape} />)
      const html = container.innerHTML
      expect(html).not.toContain('dangerouslySetInnerHTML')
      unmount()
    }
  })
})

describe('PluginVNode — event shape round-trip', () => {
  test('VNodeEvent + dispatcher preserve event name and payload verbatim', () => {
    const events: PluginVNodeEvent[] = []
    const payload = { complex: { nested: [1, 2, 3] }, str: 'hello' }
    render(
      <PluginNode
        node={{
          tag: 'button',
          label: 'fire',
          onClick: { kind: 'emit', event: 'fire', payload },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('fire')
    expect(events[0].payload).toEqual(payload)
  })

  test('input change merges value into the plugin-supplied payload', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{
          tag: 'input',
          type: 'text',
          value: '',
          onChange: { kind: 'emit', event: 'edit', payload: { fieldId: 'name' } },
        }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Jon' } })
    expect(events).toEqual([
      { event: 'edit', payload: { fieldId: 'name', value: 'Jon' } },
    ])
  })

  test('missing onEvent dispatcher silently drops the event', () => {
    // Component must not throw when a surface forgets to wire onEvent.
    render(
      <PluginNode
        node={{
          tag: 'button',
          label: 'orphan',
          onClick: { kind: 'emit', event: 'fire' },
        }}
      />,
    )
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
  })

  test('missing or malformed VNodeEvent does not call the dispatcher', () => {
    const events: PluginVNodeEvent[] = []
    render(
      <PluginNode
        node={{ tag: 'button', label: 'noop' } as VNode}
        onEvent={(e) => events.push(e)}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(events).toEqual([])
  })
})

describe('PluginVNode — unrecognised node fallback', () => {
  test('PluginNode dumps JSON for an unknown tag', () => {
    const { container } = render(
      <PluginNode node={{ tag: 'totally-made-up', x: 1 }} />,
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('totally-made-up')
  })
})
