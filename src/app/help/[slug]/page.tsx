import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HELP_PAGES, findHelpPage } from '@/help/content'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

// /help/<slug> — bundled in-app docs.
//
// Layout:
//   [   sidebar TOC   ] [          markdown content          ]
//
// Static. Generated at build time via `generateStaticParams`. All
// content lives in `src/help/content.ts` as plain markdown strings.
// Rendered with the same react-markdown stack noteser uses for note
// preview (without the wikilink / attachment custom renderers, which
// don't make sense in standalone help).

export function generateStaticParams() {
  return HELP_PAGES.map(p => ({ slug: p.slug }))
}

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return params.then(({ slug }) => {
    const page = findHelpPage(slug)
    return {
      title: page ? `${page.title} — Noteser help` : 'Noteser help',
      description: page?.summary,
    }
  })
}

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = findHelpPage(slug)
  if (!page) notFound()

  return (
    <div className="min-h-dvh bg-obsidianBlack text-obsidianText">
      <div className="mx-auto max-w-6xl flex flex-col md:flex-row gap-6 px-4 py-6">
        {/* Sidebar TOC */}
        <aside className="md:w-64 flex-none">
          <div className="sticky top-6 space-y-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-obsidianSecondaryText hover:text-obsidianText transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Back to noteser
            </Link>
            <nav aria-label="Help topics" className="rounded border border-obsidianBorder bg-obsidianGray/40">
              <h2 className="px-3 py-2 text-[10px] uppercase tracking-wide text-obsidianSecondaryText border-b border-obsidianBorder">
                Topics
              </h2>
              <ul className="divide-y divide-obsidianBorder">
                {HELP_PAGES.map(p => {
                  const active = p.slug === slug
                  return (
                    <li key={p.slug}>
                      <Link
                        href={`/help/${p.slug}`}
                        className={`block px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-obsidianAccentPurple/15 text-obsidianText border-l-2 border-obsidianAccentPurple'
                            : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText border-l-2 border-transparent'
                        }`}
                      >
                        <div>{p.title}</div>
                        <div className="text-[11px] text-obsidianSecondaryText/80 line-clamp-2 mt-0.5">
                          {p.summary}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>
        </aside>

        {/* Markdown body */}
        <article className="flex-1 min-w-0 prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {page.body}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  )
}
