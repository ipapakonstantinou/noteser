// noteser-vnode-demo v0.2.0
//
// Reference plugin for Plugin API v1.2 PR A + PR B.
//
// PR A added the new VNode shapes (button, input, list, link, radio,
// svg, box). The sidebar panel below renders one of each.
//
// PR B added the fullscreen view surface. The "VNode demo: show
// fullscreen" command opens a modal with a box that contains a
// callout, a button, and a tiny SVG so a human can confirm:
//   - opening returns a Promise that resolves once the modal is up
//   - onFullscreenMount fires + setFullscreenContent populates the body
//   - Esc + X both close + onFullscreenUnmount fires
//   - opening a second time while one is open rejects with a clear
//     message
//
// Self-contained ES module. Worker dynamic-imports via Blob URL.

function panelView(state) {
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
        placeholder: 'Type something...',
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

function fullscreenView() {
  return {
    tag: 'box',
    gap: 4,
    children: [
      {
        tag: 'callout',
        kind: 'tip',
        title: 'PR B fullscreen demo',
        body: 'This box is rendered inside the host fullscreen modal. Press Esc or click the X to close. The plugin gets onFullscreenUnmount when you do.',
      },
      {
        tag: 'button',
        label: 'Click me inside the modal',
        variant: 'primary',
        onClick: {
          kind: 'emit',
          event: 'demo.fullscreen.click',
          payload: { from: 'fullscreen-button' },
        },
      },
      {
        tag: 'svg',
        width: 320,
        height: 120,
        viewBox: [0, 0, 320, 120],
        children: [
          { tag: 'rect', x: 0, y: 0, width: 320, height: 120, fill: '#0f172a' },
          { tag: 'circle', cx: 160, cy: 60, r: 36, fill: '#38bdf8' },
          {
            tag: 'text',
            x: 110,
            y: 110,
            value: 'fullscreen surface',
            fill: '#cbd5e1',
            fontSize: 12,
          },
        ],
      },
    ],
  }
}

export default {
  id: 'noteser-vnode-demo',
  name: 'VNode demo',
  version: '0.2.0',
  author: 'Noteser',
  description:
    'Reference plugin for v1.2 PRs A and B. Exercises every new VNode shape inside a sidebar panel, and opens a fullscreen view from the command palette.',
  surfaces: {
    sidebarPanels: [{ id: 'demo', title: 'VNode demo' }],
    commands: [
      { id: 'show-fullscreen', title: 'VNode demo: show fullscreen' },
    ],
    fullscreenViews: [
      { id: 'demo-view', title: 'VNode fullscreen demo' },
    ],
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== 'demo') return
    const state = { text: '', mode: 'a' }
    ctx.setPanelContent('demo', panelView(state))
  },

  async onCommand(commandId, ctx) {
    if (commandId !== 'show-fullscreen') return
    try {
      await ctx.openFullscreen('demo-view')
    } catch (err) {
      // The host rejects when another fullscreen view is already
      // open. Surface that to the user via the toast helper instead
      // of swallowing it silently.
      ctx.notify(
        err instanceof Error ? err.message : 'Could not open fullscreen view.',
      )
    }
  },

  onFullscreenMount(viewId, ctx) {
    if (viewId !== 'demo-view') return
    ctx.setFullscreenContent('demo-view', fullscreenView())
  },

  onFullscreenUnmount(viewId, ctx) {
    if (viewId !== 'demo-view') return
    ctx.notify('Fullscreen demo closed.')
  },
}
