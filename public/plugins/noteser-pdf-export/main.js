// noteser-pdf-export v0.1.0
//
// Adds a command "Export note as PDF" that renders the active note's
// markdown to a PDF and saves it via the host's file-save capability.
//
// jsPDF (the ESM build, ~352 KB minified) is served from the same
// origin as the manifest at ./jspdf.es.min.js. Same-origin avoids
// a CSP / cross-origin script load that a CDN import would trip.
//
// Markdown handling is intentionally simple for v0.1: headings,
// paragraphs, bullet lists, code blocks. No tables, no math, no
// images. The full plugin platform is in beta; this is a smoke-test
// of the v1.1 file-save capability + a useful first step.

let jsPDFPromise = null

async function loadJsPDF() {
  // Cache the import promise so concurrent invocations share one
  // fetch. We resolve the URL against the manifest URL — that way the
  // same `./jspdf.es.min.js` path works regardless of where the
  // plugin is hosted (noteser.app, GitHub Pages, etc.).
  if (jsPDFPromise === null) {
    // import.meta.url is the URL of THIS module inside the worker.
    // For a Blob-URL'd worker, it points at the blob: scheme; we
    // resolve relative to the plugin's published location instead by
    // splicing the manifest's directory into a known path. Since
    // the host calls us with the verbatim main.js text shipped to
    // the worker, we cannot read its original URL directly — so we
    // hardcode the path. The host fetches from a known location and
    // serves it; the plugin author controls both files.
    jsPDFPromise = import('/plugins/noteser-pdf-export/jspdf.es.min.js').then(
      (mod) => mod.jsPDF,
    )
  }
  return jsPDFPromise
}

// Render a string of markdown to a jsPDF document. Returns the bytes.
function renderMarkdownToPdf(jsPDF, title, markdown) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const PAGE_HEIGHT = doc.internal.pageSize.getHeight()
  const PAGE_WIDTH = doc.internal.pageSize.getWidth()
  const MARGIN = 48
  const MAX_WIDTH = PAGE_WIDTH - 2 * MARGIN
  let y = MARGIN

  const ensureSpace = (lineHeight) => {
    if (y + lineHeight > PAGE_HEIGHT - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
  }

  const drawText = (text, size, style = 'normal', leading = 1.4) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    const lineHeight = size * leading
    const lines = doc.splitTextToSize(text, MAX_WIDTH)
    for (const line of lines) {
      ensureSpace(lineHeight)
      doc.text(line, MARGIN, y)
      y += lineHeight
    }
  }

  // Title page-ish header
  if (title) {
    drawText(title, 22, 'bold', 1.3)
    y += 6
  }

  // Walk the markdown line by line. Simple state machine for code blocks.
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let inCode = false
  let codeBuffer = []
  for (const raw of lines) {
    const fence = raw.match(/^```/)
    if (fence) {
      if (inCode) {
        // Flush code block.
        const codeText = codeBuffer.join('\n')
        const codeHeight = 12 * 1.4 * (codeBuffer.length + 1)
        ensureSpace(codeHeight)
        doc.setFillColor(245, 245, 245)
        doc.rect(MARGIN, y - 4, MAX_WIDTH, codeHeight, 'F')
        doc.setFont('courier', 'normal')
        doc.setFontSize(10)
        const codeLines = doc.splitTextToSize(codeText, MAX_WIDTH - 8)
        for (const cl of codeLines) {
          ensureSpace(12 * 1.4)
          doc.text(cl, MARGIN + 4, y + 8)
          y += 12 * 1.4
        }
        y += 6
        codeBuffer = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(raw)
      continue
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      y += 8
      continue
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const sizes = [20, 17, 15, 13, 12, 11]
      drawText(h[2], sizes[level - 1], 'bold', 1.3)
      y += 4
      continue
    }
    const bullet = trimmed.match(/^[-*+]\s+(.*)$/)
    if (bullet) {
      drawText('• ' + bullet[1], 11)
      continue
    }
    drawText(trimmed, 11)
  }

  // Flush an unterminated code block at end-of-doc.
  if (inCode && codeBuffer.length > 0) {
    doc.setFont('courier', 'normal')
    doc.setFontSize(10)
    for (const cl of codeBuffer) {
      ensureSpace(12 * 1.4)
      doc.text(cl, MARGIN, y)
      y += 12 * 1.4
    }
  }

  // jsPDF.output('arraybuffer') returns the PDF bytes.
  const buf = doc.output('arraybuffer')
  return new Uint8Array(buf)
}

function safeName(title) {
  const base = (title || 'note').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80)
  return (base || 'note') + '.pdf'
}

export default {
  id: 'noteser-pdf-export',
  name: 'PDF export',
  version: '0.1.0',
  author: 'Noteser',
  permissions: ['file-save'],
  surfaces: {
    commands: [{ id: 'export', title: 'Export note as PDF' }],
  },

  async onCommand(id, ctx) {
    if (id !== 'export') return
    const note = ctx.activeNote
    if (!note) {
      ctx.notify('Open a note first, then run Export note as PDF.')
      return
    }
    ctx.notify('Generating PDF…')
    try {
      const jsPDF = await loadJsPDF()
      const bytes = renderMarkdownToPdf(jsPDF, note.title, note.content || '')
      await ctx.requestFileSave({
        suggestedName: safeName(note.title),
        mimeType: 'application/pdf',
        bytes,
      })
      ctx.notify('PDF saved.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.notify('PDF export failed: ' + msg)
    }
  },
}
