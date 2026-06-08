import { notFound } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HELP_PAGES, findHelpPage } from '@/help/content'
import { parseHelpBody } from '@/help/sections'
import { HelpShell } from '../HelpShell'

// /help/<slug> — bundled in-app docs.
//
// Layout:
//   [ topbar (back link) ............................................. ]
//   [ sidebar TOC ] [ markdown content with per-section disclosures   ]
//
// Static. Generated at build time via `generateStaticParams`. All
// content lives in `src/help/content.ts` as plain markdown strings.
// Rendered with the same react-markdown stack noteser uses for note
// preview (without the wikilink / attachment custom renderers, which
// don't make sense in standalone help).
//
// The intro chunk (H1 + lead paragraph before the first H2) renders
// always-visible at the top. Every H2 section becomes a default-
// collapsed `<details>` block: heading text in the `<summary>`, body
// markdown in the panel. Deep links into a specific section
// (e.g. /help/faq#vault-locked) are handled by the HelpShell hash hook,
// which opens the matching `<details>` on load + on hashchange.

export function generateStaticParams() {
  return HELP_PAGES.map(p => ({ slug: p.slug }))
}

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return params.then(({ slug }) => {
    const page = findHelpPage(slug)
    return {
      title: page ? `${page.title} | Noteser help` : 'Noteser help',
      description: page?.summary,
    }
  })
}

// Heading-id slugger used inside the intro chunk so any h1/h3 still gets
// an anchor target. Section h2 headings are anchored by their disclosure
// container instead — see the section render loop below.
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props
    return getText(props?.children)
  }
  return ''
}

function makeComponents(): Components {
  // Per-render slug map so duplicate headings inside a single page get
  // suffixed slugs (foo, foo-1, foo-2). Mirrors parseHelpBody().
  const seen = new Map<string, number>()
  const slugFor = (text: string) => {
    const base = slugifyHeading(text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n}`
  }
  return {
    h1: ({ children }) => <h1 id={slugFor(getText(children))}>{children}</h1>,
    h2: ({ children }) => <h2 id={slugFor(getText(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugFor(getText(children))}>{children}</h3>,
  }
}

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = findHelpPage(slug)
  if (!page) notFound()

  const { intro, sections } = parseHelpBody(page.body)
  const sectionSlugs = sections.map(s => s.slug)

  return (
    <HelpShell activeSlug={slug} sectionSlugs={sectionSlugs}>
      {intro && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents()}>
          {intro}
        </ReactMarkdown>
      )}
      {sections.map(section => (
        <details
          key={section.slug}
          id={`help-section-${section.slug}`}
          className="help-disclosure"
        >
          <summary className="help-disclosure-summary">
            <span className="help-disclosure-chevron" aria-hidden="true" />
            <h2 id={section.slug} className="help-disclosure-heading">
              {section.heading}
            </h2>
          </summary>
          <div className="help-disclosure-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents()}>
              {section.body}
            </ReactMarkdown>
          </div>
        </details>
      ))}
    </HelpShell>
  )
}
