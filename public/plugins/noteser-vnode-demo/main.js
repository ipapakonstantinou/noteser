// noteser-vnode-demo v0.1.0
//
// Reference plugin for Plugin API v1.2 PR A. Renders one of every new
// VNode shape (button, input, list, link, radio, svg, box) inside a
// sidebar panel so a human can confirm the end-to-end wire works.
//
// The event-handler wire (ctx.onVNodeEvent) lands in a later PR. This
// plugin logs to the worker console so the developer can see that the
// renderer produced the right DOM and the event records made it back
// across postMessage. Once ctx.onVNodeEvent ships, this plugin will
// flip the logged values into live state without changing its VNode
// shapes.
//
// Self-contained ES module. Worker dynamic-imports via Blob URL.

function render(state) {
  return {
    tag: 'box',
    gap: 3,
    children: [
      { tag: 'text', value: 'Plugin v1.2 VNode demo' },

      {
        tag: 'callout',
        kind: 'info',
        title: 'What this panel is for',
        body: 'Every new VNode shape in PR A renders here. Click the button, type in the input, pick a radio. The worker logs each event so you can confirm the wire works.',
      },

      {
        tag: 'button',
        label: 'Click me',
        variant: 'primary',
        onClick: { kind: 'emit', event: 'demo.click', payload: { from: 'button' } },
      },

      {
        tag: 'input',
        type: 'text',
        value: state.text,
        placeholder: 'Type something…',
        onChange: { kind: 'emit', event: 'demo.text' },
      },

      {
        tag: 'radio',
        group: 'mode',
        value: state.mode,
        options: [
          { value: 'a', label: 'Mode A' },
          { value: 'b', label: 'Mode B' },
        ],
        onChange: { kind: 'emit', event: 'demo.mode' },
      },

      {
        tag: 'list',
        ordered: false,
        items: [
          { tag: 'text', value: 'List item one' },
          { tag: 'text', value: 'List item two' },
          {
            tag: 'link',
            label: 'Open a note by id',
            href: { kind: 'note', noteId: 'sample-note-id' },
          },
        ],
      },

      {
        tag: 'svg',
        width: 200,
        height: 100,
        viewBox: [0, 0, 200, 100],
        children: [
          { tag: 'rect', x: 0, y: 0, width: 200, height: 100, fill: '#1e293b' },
          { tag: 'line', x1: 0, y1: 50, x2: 200, y2: 50, stroke: '#475569', strokeWidth: 1 },
          {
            tag: 'circle',
            cx: 100,
            cy: 50,
            r: 20,
            fill: '#4f8',
            onClick: { kind: 'emit', event: 'demo.circle' },
          },
          { tag: 'text', x: 75, y: 90, value: 'svg shapes', fill: '#cbd5e1', fontSize: 12 },
        ],
      },
    ],
  }
}

export default {
  id: 'noteser-vnode-demo',
  name: 'VNode demo',
  version: '0.1.0',
  author: 'Noteser',
  description:
    'Reference plugin for v1.2 PR A. Exercises every new VNode shape inside a sidebar panel.',
  surfaces: {
    sidebarPanels: [{ id: 'demo', title: 'VNode demo' }],
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== 'demo') return
    const state = { text: '', mode: 'a' }
    ctx.setPanelContent('demo', render(state))
    // ctx.onVNodeEvent ships in a later v1.2 PR — for now the worker
    // simply emits the VNodes and trusts the renderer's event wire.
    // Once the event registration API lands, this handler will read
    // the click / change events and re-render the panel with new
    // state. The shapes themselves do not change.
  },
}
