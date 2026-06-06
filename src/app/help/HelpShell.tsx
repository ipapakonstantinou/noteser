'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, SunIcon, MoonIcon } from '@heroicons/react/24/outline'
import { HELP_PAGES, type HelpPage } from '@/help/content'

const STORAGE_KEY = 'noteser-help-theme'

type HelpTheme = 'dark' | 'light'

interface TocItem {
  level: 2 | 3
  text: string
  slug: string
}

// Heading extraction — pulls h2/h3 lines out of the raw markdown body so
// the right-hand "On this page" rail mirrors react-markdown's slugger
// output. We re-implement the slugger here (lowercase, replace non-alnum
// with hyphens, collapse runs, trim) rather than wire rehype-slug just
// for the sidebar; the article body still renders without anchor IDs and
// the TOC links are plain hash refs that work because rehype-slug-style
// slugs are the GitBook convention browsers tolerate.
function extractToc(body: string): TocItem[] {
  const items: TocItem[] = []
  const seen = new Set<string>()
  for (const line of body.split('\n')) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const level = m[1].length === 2 ? 2 : 3
    const text = m[2].replace(/`/g, '').trim()
    let slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    let candidate = slug
    let n = 1
    while (seen.has(candidate)) {
      candidate = `${slug}-${n++}`
    }
    seen.add(candidate)
    items.push({ level: level as 2 | 3, text, slug: candidate })
  }
  return items
}

interface HelpShellProps {
  activeSlug: string
  page: HelpPage
  children: React.ReactNode
}

export function HelpShell({ activeSlug, page, children }: HelpShellProps) {
  // Default night: render dark on first paint, then hydrate from
  // localStorage in an effect. This matches the spec ("Default = night
  // for new visitors") and avoids a light-flash on cold load for
  // returning dark-theme users (server already paints dark, effect
  // confirms dark, no transition needed).
  const [theme, setTheme] = useState<HelpTheme>('dark')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored)
      }
    } catch {
      // localStorage access can throw in private-mode Safari etc.
      // Silently keep the dark default.
    }
    setHydrated(true)
  }, [])

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore — toggle still works in-session
      }
      return next
    })
  }

  const toc = useMemo(() => extractToc(page.body), [page.body])

  const isLight = theme === 'light'

  const shellCls = isLight
    ? 'bg-white text-[#1a1a1a]'
    : 'bg-[#16181c] text-[#e5e7eb]'
  const headerCls = isLight
    ? 'border-b border-[#e5e7eb] bg-white/90'
    : 'border-b border-[#23262d] bg-[#16181c]/90'
  const sidebarCls = isLight
    ? 'bg-[#fafbfc] border-r border-[#e5e7eb]'
    : 'bg-[#1a1c20] border-r border-[#23262d]'
  const tocCls = isLight ? 'text-[#6b7280]' : 'text-[#8b95a7]'
  const linkCls = isLight
    ? 'text-[#4b5563] hover:text-[#1a1a1a]'
    : 'text-[#9ca3af] hover:text-[#e5e7eb]'

  const sectionLabelCls = isLight
    ? 'text-[#9ca3af]'
    : 'text-[#6b7280]'

  return (
    <div
      className={`min-h-dvh ${shellCls}`}
      data-help-theme={theme}
      data-help-hydrated={hydrated ? 'true' : 'false'}
      style={{ fontFamily: 'var(--font-interface)' }}
    >
      <header
        className={`sticky top-0 z-20 ${headerCls} backdrop-blur supports-[backdrop-filter]:bg-opacity-80`}
      >
        <div className="mx-auto max-w-[1400px] flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className={`inline-flex items-center gap-2 text-sm ${linkCls} transition-colors`}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Back to noteser</span>
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
              isLight
                ? 'text-[#4b5563] hover:bg-[#f3f4f6]'
                : 'text-[#9ca3af] hover:bg-[#23262d]'
            }`}
          >
            {isLight ? (
              <MoonIcon className="w-5 h-5" aria-hidden="true" />
            ) : (
              <SunIcon className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row">
        <aside
          className={`md:w-72 md:flex-none ${sidebarCls} md:min-h-[calc(100dvh-57px)]`}
        >
          <nav
            aria-label="Help topics"
            className="sticky top-[57px] px-4 py-6 space-y-1"
          >
            <h2
              className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${sectionLabelCls}`}
            >
              Topics
            </h2>
            <ul className="space-y-0.5">
              {HELP_PAGES.map(p => {
                const active = p.slug === activeSlug
                const itemCls = active
                  ? isLight
                    ? 'bg-[#eff6ff] text-[#1a1a1a] border-l-2 border-[#3a86ff] font-medium'
                    : 'bg-[#1e2530] text-[#f3f4f6] border-l-2 border-[#3a86ff] font-medium'
                  : isLight
                    ? 'text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#1a1a1a] border-l-2 border-transparent'
                    : 'text-[#9ca3af] hover:bg-[#1e2126] hover:text-[#e5e7eb] border-l-2 border-transparent'
                return (
                  <li key={p.slug}>
                    <Link
                      href={`/help/${p.slug}`}
                      className={`block pl-3 pr-3 py-2 text-[14px] leading-[1.45] rounded-r-md transition-colors ${itemCls}`}
                    >
                      {p.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 min-w-0 px-6 md:px-12 py-10 md:py-14">
          <article
            className={`max-w-[720px] mx-auto help-prose ${isLight ? 'help-prose-light' : 'help-prose-dark'}`}
          >
            {children}
          </article>
        </main>

        {toc.length > 1 && (
          <aside className="hidden xl:block xl:w-60 xl:flex-none">
            <nav
              aria-label="On this page"
              className="sticky top-[57px] px-4 py-10 text-[13px]"
            >
              <h2
                className={`px-2 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] ${sectionLabelCls}`}
              >
                On this page
              </h2>
              <ul className="space-y-1">
                {toc.map(item => (
                  <li
                    key={item.slug}
                    className={item.level === 3 ? 'pl-3' : ''}
                  >
                    <a
                      href={`#${item.slug}`}
                      className={`block py-1 px-2 rounded transition-colors ${tocCls} ${
                        isLight
                          ? 'hover:text-[#3a86ff]'
                          : 'hover:text-[#60a5fa]'
                      }`}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </div>
  )
}
