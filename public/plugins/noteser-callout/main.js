// noteser-callout v0.1.0
//
// Renders fenced code blocks in five admonition languages
// (```note / ```info / ```tip / ```warn / ```danger) as colored
// callout boxes. First line of the body becomes the title if it
// matches `title: …`; otherwise the kind name is used.
//
// Self-contained ES module. Worker dynamic-imports via Blob URL.

function parseTitle(source) {
  // Match a leading "title: My title" line. Lets the user override
  // the default callout label per block without complicating the
  // VNode shape.
  const m = source.match(/^title:\s*(.+?)\s*\n([\s\S]*)$/)
  if (m) return { title: m[1].trim(), body: m[2] }
  return { title: undefined, body: source }
}

function render(kind, source) {
  const { title, body } = parseTitle(source)
  return {
    tag: 'callout',
    kind,
    title,
    body,
  }
}

export default {
  id: 'noteser-callout',
  name: 'Callouts',
  version: '0.1.0',
  author: 'Noteser',
  surfaces: {
    codeBlockRenderers: [
      { language: 'note' },
      { language: 'info' },
      { language: 'tip' },
      { language: 'warn' },
      { language: 'danger' },
    ],
  },

  onRenderCodeBlock({ language, source, blockId }, ctx) {
    ctx.renderCodeBlock(blockId, render(language.toLowerCase(), source))
  },
}
