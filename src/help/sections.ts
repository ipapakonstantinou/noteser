// Split a help-page markdown body into a top-of-page intro plus a list of
// H2 sections. Each section is rendered as a `<details>` disclosure by the
// /help page component — the heading text becomes the `<summary>`, the
// body becomes the disclosure panel.
//
// The page only nests one level of disclosures (H2 sections). H3+ stays
// as plain prose inside the H2 panel. This matches the actual content
// shape in content.ts: every page is one H1 plus a flat list of H2
// chunks, no deeper nesting.

export interface HelpSection {
  // The H2 heading text, with backticks stripped (matches the GitBook
  // slugger that already drives this page).
  heading: string
  // Slug used as the disclosure id + URL hash target. Computed by the
  // page component with collision-free numbering so duplicate headings
  // still link uniquely.
  slug: string
  // The markdown body that follows the H2, up to (but not including)
  // the next H2 or end of page.
  body: string
}

export interface ParsedHelpBody {
  // Markdown that appears before the first H2. Includes the H1 title and
  // any lead paragraph. Rendered always-visible at the top of the page.
  intro: string
  sections: HelpSection[]
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseHelpBody(body: string): ParsedHelpBody {
  const lines = body.split('\n')
  const sections: HelpSection[] = []
  const seen = new Map<string, number>()

  let introLines: string[] = []
  let current: { heading: string; slug: string; lines: string[] } | null = null

  // Track whether we're inside a fenced code block so an h2-looking line
  // inside ```...``` does not get treated as a section heading.
  let inFence = false

  const closeCurrent = () => {
    if (current) {
      sections.push({
        heading: current.heading,
        slug: current.slug,
        body: current.lines.join('\n').replace(/^\n+|\n+$/g, ''),
      })
      current = null
    }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
    }
    const m = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null
    if (m) {
      closeCurrent()
      const heading = m[1].replace(/`/g, '').trim()
      const base = slugify(heading)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const slug = n === 0 ? base : `${base}-${n}`
      current = { heading, slug, lines: [] }
      continue
    }
    if (current) {
      current.lines.push(line)
    } else {
      introLines.push(line)
    }
  }
  closeCurrent()

  return {
    intro: introLines.join('\n').replace(/^\n+|\n+$/g, ''),
    sections,
  }
}
