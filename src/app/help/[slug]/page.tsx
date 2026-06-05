import { notFound } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HELP_PAGES, findHelpPage } from '@/help/content'
import { HelpShell } from '../HelpShell'

// /help/<slug> — bundled in-app docs.
//
// Layout:
//   [ topbar (back link + theme toggle) ........................... ]
//   [ sidebar TOC ] [ markdown content ] [ on-this-page mini-TOC ]
//
// Static. Generated at build time via `generateStaticParams`. All
// content lives in `src/help/content.ts` as plain markdown strings.
// Rendered with the same react-markdown stack noteser uses for note
// preview (without the wikilink / attachment custom renderers, which
// don't make sense in standalone help).
//
// Chrome / palette / theme toggle live in HelpShell (client). The page
// stays a server component so generateStaticParams + generateMetadata
// still apply at build time.

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

// Mirrors extractToc() in HelpShell so heading anchors line up with the
// "On this page" rail. Kept here-and-there rather than shared because
// the shell is a client component and we want the page (server) to
// stay free of client imports.
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

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = findHelpPage(slug)
  if (!page) notFound()

  // Track heading occurrences across the article so duplicate titles get
  // suffixed slugs (foo, foo-1, foo-2). Mirrors extractToc()'s logic.
  const seenHeadings = new Map<string, number>()
  const slugFor = (text: string) => {
    const base = slugifyHeading(text)
    const n = seenHeadings.get(base) ?? 0
    seenHeadings.set(base, n + 1)
    return n === 0 ? base : `${base}-${n}`
  }

  const components: Components = {
    h1: ({ children }) => <h1 id={slugFor(getText(children))}>{children}</h1>,
    h2: ({ children }) => <h2 id={slugFor(getText(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugFor(getText(children))}>{children}</h3>,
  }

  return (
    <HelpShell activeSlug={slug} page={page}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {page.body}
      </ReactMarkdown>
    </HelpShell>
  )
}
