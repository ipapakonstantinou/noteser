// noteser-word-count v0.1.0
//
// Self-contained ES module. The Worker dynamic-imports this file via
// a Blob URL, so no relative imports and no SDK dependency is bundled
// in — `definePlugin` is identity at runtime, and the host validates
// the manifest itself.
//
// Usage: serve this file + manifest.json at any HTTPS URL, paste the
// manifest URL into Settings → Plugins in Noteser.

const WORDS_PER_MINUTE = 220

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length
}

function format(text) {
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

export default {
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
}
