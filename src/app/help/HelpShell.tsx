'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { HELP_PAGES } from '@/help/content'

interface HelpShellProps {
  activeSlug: string
  // Slugs (in source order) of the disclosure sections rendered inside
  // `children`. Passed by the page so the shell can open the section
  // that matches the URL hash on load. Source order keeps the open
  // logic deterministic across slug collisions handled at parse time.
  sectionSlugs: string[]
  children: React.ReactNode
}

// Chrome for every /help page. Inherits the main app theme (dark) from
// the root <html class="dark"> in src/app/layout.tsx, so there is no
// per-help theme toggle and no per-help localStorage key. Layout:
//
//   [ topbar (back link only) ........................................ ]
//   [ sidebar TOC ] [ markdown content with per-section disclosures   ]
//
// The old right-rail "On this page" TOC is gone. Per-topic disclosures
// inside the article handle in-page navigation. The hash-watcher below
// keeps deep links like /help/faq#vault-locked working: when the hash
// matches a known section slug, the matching <details> is opened and
// the page re-scrolls to the heading after the disclosure expands.
export function HelpShell({ activeSlug, sectionSlugs, children }: HelpShellProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const openMatchingSection = () => {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return
      if (!sectionSlugs.includes(hash)) return
      const el = document.getElementById(`help-section-${hash}`)
      if (el && el instanceof HTMLDetailsElement && !el.open) {
        el.open = true
        // Browsers anchor-scroll before the details element opens, so
        // the section header ends up off-screen without this nudge.
        requestAnimationFrame(() => {
          const target = document.getElementById(hash) ?? el
          target.scrollIntoView({ block: 'start' })
        })
      }
    }

    openMatchingSection()
    window.addEventListener('hashchange', openMatchingSection)
    return () => window.removeEventListener('hashchange', openMatchingSection)
  }, [sectionSlugs])

  return (
    <div
      className="min-h-dvh bg-[#16181c] text-[#e5e7eb]"
      style={{ fontFamily: 'var(--font-interface)' }}
    >
      <header className="sticky top-0 z-20 border-b border-[#23262d] bg-[#16181c]/90 backdrop-blur supports-[backdrop-filter]:bg-opacity-80">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#9ca3af] hover:text-[#e5e7eb] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Back to noteser</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row">
        <aside className="md:w-72 md:flex-none bg-[#1a1c20] border-r border-[#23262d] md:min-h-[calc(100dvh-57px)]">
          <nav
            aria-label="Help topics"
            className="sticky top-[57px] px-4 py-6 space-y-1"
          >
            <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">
              Topics
            </h2>
            <ul className="space-y-0.5">
              {HELP_PAGES.map(p => {
                const active = p.slug === activeSlug
                const itemCls = active
                  ? 'bg-[#1e2530] text-[#f3f4f6] border-l-2 border-[#3a86ff] font-medium'
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
          <article className="max-w-[820px] mx-auto help-prose help-prose-dark">
            {children}
          </article>
        </main>
      </div>
    </div>
  )
}
