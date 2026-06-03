// noteser-word-count — reference plugin.
//
// Sidebar panel that shows the word count + reading-time estimate
// for the currently-open note. Re-renders when the user switches
// notes.
//
// Bundle to a single ES module (e.g. via esbuild --format=esm
// --bundle) and host `main.js` + `manifest.json` at any HTTPS URL.
// Users add it via Settings → Plugins.

import { definePlugin } from '@noteser/plugin-sdk'

const WORDS_PER_MINUTE = 220

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function format(text: string): { tag: 'text'; value: string } {
  if (!text) {
    return { tag: 'text', value: 'Open a note to see its word count.' }
  }
  const words = countWords(text)
  const chars = text.length
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE))
  return {
    tag: 'text',
    value: `${words} words · ${chars} chars · ~${minutes} min read`,
  }
}

export default definePlugin({
  id: 'noteser-word-count',
  name: 'Word count',
  version: '0.1.0',
  author: 'Noteser',
  surfaces: {
    sidebarPanels: [{ id: 'panel', title: 'Word count' }],
  },

  onPanelMount(panelId, ctx) {
    ctx.setPanelContent(panelId, format(ctx.activeNote?.content ?? ''))
  },

  onActiveNoteChange(note, ctx) {
    ctx.setPanelContent('panel', format(note?.content ?? ''))
  },
})
