// noteser-vnode-demo v0.3.0
//
// Reference plugin for Plugin API v1.2 PR A + PR B + the VNode event
// delivery follow-up.
//
// PR A added the new VNode shapes (button, input, list, link, radio,
// svg, box). The sidebar panel below renders one of each.
//
// PR B added the fullscreen view surface. The "VNode demo: show
// fullscreen" command opens a modal containing a callout, button, and
// SVG.
//
// The follow-up wires `host:vnodeEvent` delivery + adds
// `ctx.onVNodeEvent`. This version subscribes via that API and logs
// every event the host forwards. Clicking the button, typing in the
// input, picking a radio, or clicking the SVG circle all surface as
// notify toasts so a human can confirm the round-trip end-to-end.
//
// The "Open the first note" link demonstrates the wikilink:// click
// intercept. The plugin asks the host for the active note's id via
// onActiveNoteChange and renders a link to it; clicking dispatches
// openNote(noteId) instead of the browser trying to navigate to an
// unknown scheme.
//
// Self-contained ES module. Worker dynamic-imports via Blob URL.

function panelView(state) {
  const items = [
    { tag: 'text', value: 'List item one' },
    { tag: 'text', value: 'List item two' },
  ]
  if (state.activeNoteId) {
    items.push({
      tag: 'link',
      label: `Open the current note (${state.activeNoteId.slice(0, 8)}…)`,
      href: { kind: 'note', noteId: state.activeNoteId },
    })
  } else {
    items.push({ tag: 'text', value: '(open a note to see a wikilink demo link)' })
  }

  return {
    tag: 'box',
    gap: 3,
    children: [
      { tag: 'text', value: 'Plugin v1.2 VNode demo' },

      {
        tag: 'callout',
        kind: 'info',
        title: 'What this panel is for',
        body: 'Every new VNode shape in PR A renders here. Click the button, type in the input, pick a radio. Each event surfaces as a toast — the host forwards them via the VNode event delivery wire.',
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
        items,
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
        body: 'This box is rendered inside the host fullscreen modal. Press Esc or click the X to close. Click the button and the worker will log a fullscreen-source event.',
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

// Mutable panel state. The renderer rebuilds the tree from this snapshot
// every time the plugin pushes a new setPanelContent.
const panelState = { text: '', mode: 'a', activeNoteId: null }

export default {
  id: 'noteser-vnode-demo',
  name: 'VNode demo',
  version: '0.3.0',
  author: 'Noteser',
  description:
    'Reference plugin for v1.2 PRs A, B, and the VNode event delivery follow-up. Renders every new VNode shape in a sidebar panel, opens a fullscreen view from the palette, and logs every VNode event the host forwards.',
  surfaces: {
    sidebarPanels: [{ id: 'demo', title: 'VNode demo' }],
    commands: [
      { id: 'show-fullscreen', title: 'VNode demo: show fullscreen' },
    ],
    fullscreenViews: [
      { id: 'demo-view', title: 'VNode fullscreen demo' },
    ],
  },

  onActivate(ctx) {
    // Subscribe to every VNode event the host forwards. The handler
    // receives { event, payload, source } — `source.kind` tells us
    // which rendered surface produced the event so we can branch.
    ctx.onVNodeEvent(({ event, payload, source }) => {
      // Surface as a toast so the human running the demo can see the
      // round-trip without opening devtools.
      const label =
        source.kind === 'panel'
          ? `panel "${source.panelId}"`
          : source.kind === 'fullscreen'
          ? `fullscreen "${source.viewId}"`
          : `code block "${source.blockId}"`
      ctx.notify(`event "${event}" from ${label}`)

      // Update local state on the controlled inputs so the next render
      // reflects what the user typed / picked.
      if (event === 'demo.text' && payload && typeof payload === 'object') {
        panelState.text = String(payload.value ?? '')
        ctx.setPanelContent('demo', panelView(panelState))
      }
      if (event === 'demo.mode' && payload && typeof payload === 'object') {
        panelState.mode = String(payload.value ?? 'a')
        ctx.setPanelContent('demo', panelView(panelState))
      }
    })

    // Console log every event too, for the devtools smoke check the
    // task plan calls out.
    ctx.onVNodeEvent((args) => {
      // eslint-disable-next-line no-console
      console.log('[noteser-vnode-demo] vnodeEvent', args)
    })
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== 'demo') return
    panelState.activeNoteId = ctx.activeNote?.id ?? null
    ctx.setPanelContent('demo', panelView(panelState))
  },

  onActiveNoteChange(note, ctx) {
    panelState.activeNoteId = note?.id ?? null
    // Push a fresh tree so the wikilink demo link follows the active note.
    ctx.setPanelContent('demo', panelView(panelState))
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
