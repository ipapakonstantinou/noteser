// Test plugin — minimum useful slice that exercises every Worker→Host
// message type. Not shipped to end users; the host loads this only in
// the test harness and (eventually) as a dev-mode plugin from
// `plugins/test-plugin/main.js` for hand-testing during week 2.
//
// Surfaces:
//   • One command "say-hello" that emits a notify toast.
//   • One sidebar panel "echo-panel" that mirrors the active note's
//     title in its content.
//   • One code-block renderer for the "echo" fence language that
//     wraps the source in a [echo] prefix.

import { definePlugin } from '@/plugins/sdk'

export default definePlugin({
  id: 'test-plugin',
  name: 'Test plugin',
  version: '0.1.0',
  author: 'noteser dev',
  surfaces: {
    commands: [{ id: 'say-hello', title: 'Test: say hello' }],
    sidebarPanels: [{ id: 'echo-panel', title: 'Echo' }],
    codeBlockRenderers: [{ language: 'echo' }],
  },

  onActivate(ctx) {
    ctx.setSetting('booted', true)
  },

  onCommand(id, ctx) {
    if (id === 'say-hello') {
      ctx.notify('Hello from the test plugin')
    }
  },

  onPanelMount(panelId, ctx) {
    if (panelId !== 'echo-panel') return
    const title = ctx.activeNote?.title ?? '(no active note)'
    ctx.setPanelContent(panelId, { tag: 'text', value: `active: ${title}` })
  },

  onActiveNoteChange(note, ctx) {
    const title = note?.title ?? '(no active note)'
    ctx.setPanelContent('echo-panel', { tag: 'text', value: `active: ${title}` })
  },

  onRenderCodeBlock({ language, source, blockId }, ctx) {
    if (language !== 'echo') return
    ctx.renderCodeBlock(blockId, { tag: 'text', value: `[echo] ${source}` })
  },
})
