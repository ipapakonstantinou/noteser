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
//   [ left tree nav | markdown content (flowing, no inline details)   ]
//
// Static. Generated at build time via `generateStaticParams`. All
// content lives in `src/help/content.ts` as plain markdown strings.
// Rendered with the same react-markdown stack noteser uses for note
// preview (without the wikilink / attachment custom renderers, which
// don't make sense in standalone help).
//
// PR #154: H2 sections used to render as `<details>` disclosures. The
// nesting moved into the LEFT NAV as a tree, so the body now renders
// as a single flowing markdown document. The page still calls
// parseHelpBody to keep H2 anchor ids stable (so deep links from the
// left nav scroll correctly), then concatenates intro + sections back
// into one ReactMarkdown render. Concatenation preserves source order;
// duplicate-heading slugs stay deterministic because we feed all
// h2s through the same per-render slug counter in `makeComponents`.

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

// Heading-id slugger. Mirrors parseHelpBody so a link in the left nav
// (`/help/<slug>#<section-slug>`) lands on the matching <h2 id="...">
// inside the rendered article.
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

  // We still call parseHelpBody so adding a new H2 to content.ts
  // automatically populates the left-nav tree. The body itself is
  // rendered as a single flowing markdown string.
  parseHelpBody(page.body)

  return (
    <HelpShell activeSlug={slug}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents()}>
        {page.body}
      </ReactMarkdown>
    </HelpShell>
  )
}
