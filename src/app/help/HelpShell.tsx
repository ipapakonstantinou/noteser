'use client'

import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { HELP_PAGES } from '@/help/content'
import { parseHelpBody } from '@/help/sections'

interface HelpShellProps {
  activeSlug: string
  children: React.ReactNode
}

// Chrome for every /help page. Inherits the main app dark theme from the
// root <html class="dark"> in src/app/layout.tsx (no per-help theme key,
// no toggle — that was removed in PR #153). Layout:
//
//   [ topbar (back link only) ........................................ ]
//   [ left tree nav | markdown content (flowing, no inline details)   ]
//
// PR #154: the per-H2 disclosures moved out of the BODY and into the
// LEFT NAV as a collapsible tree. Each main topic shows a chevron next
// to its label; click the chevron to expand and reveal that topic's
// H2 sub-section anchors. Click a sub-section to navigate to the topic
// AND scroll to the matching heading (`/help/<topic>#<section-slug>`).
//
// The currently-active topic auto-expands on mount so the user can see
// where they are inside that topic. Persisting expand state across
// navigation is intentionally NOT done — each page render starts with
// just the active topic open. Keeps the nav free of stale state when a
// user jumps between unrelated topics.
//
// Above the TOPICS label sits a single "Expand all / Collapse all"
// toggle button. The label flips based on whether every topic that has
// sub-sections is currently expanded. Click → either expand every
// topic at once or close them all.
//
// Keyboard navigation:
//   - Tab cycles through chevrons + topic links + sub-section links
//     in source order. Native focus.
//   - Arrow Down / Arrow Up moves between focusable nav items.
//   - Enter / Space activates whatever is focused (native button +
//     anchor behavior).
//   - Right Arrow on a chevron-row expands; Left Arrow collapses.
//
// Hash scroll: the body now flows without disclosures, so the URL hash
// resolves natively. The hook below still nudges scrollIntoView on
// hashchange because Next's anchor-scroll can fire before the page is
// painted, which leaves the heading hidden behind the sticky topbar.
export function HelpShell({ activeSlug, children }: HelpShellProps) {
  // Map<topic-slug, H2 sections> — computed once. parseHelpBody is pure
  // and the HELP_PAGES list is static at build time.
  const sectionsByPage = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseHelpBody>['sections']>()
    for (const p of HELP_PAGES) {
      map.set(p.slug, parseHelpBody(p.body).sections)
    }
    return map
  }, [])

  // Active topic auto-expands. Other topics start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([activeSlug]))

  // When the user navigates to a new topic (activeSlug changes), make
  // sure that topic is expanded so they see their location in the tree.
  // Other manual expansions stay open within the same client-side
  // navigation — only collapsed topics get auto-expanded, never the
  // reverse.
  useEffect(() => {
    setExpanded(prev => {
      if (prev.has(activeSlug)) return prev
      const next = new Set(prev)
      next.add(activeSlug)
      return next
    })
  }, [activeSlug])

  const toggle = useCallback((slug: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  // Expand-all / Collapse-all toggle. Only topics that actually have
  // sub-sections count for the "are they all open?" check — topics
  // without sub-sections have nothing to expand and would otherwise
  // make the button label stick on "Expand all" forever.
  const expandableSlugs = useMemo(
    () =>
      HELP_PAGES.filter(p => (sectionsByPage.get(p.slug)?.length ?? 0) > 0).map(p => p.slug),
    [sectionsByPage],
  )
  const allExpanded =
    expandableSlugs.length > 0 && expandableSlugs.every(slug => expanded.has(slug))
  const toggleAll = useCallback(() => {
    setExpanded(prev => {
      const everyOpen =
        expandableSlugs.length > 0 && expandableSlugs.every(slug => prev.has(slug))
      return everyOpen ? new Set<string>() : new Set<string>(expandableSlugs)
    })
  }, [expandableSlugs])

  // Hash-scroll nudge. Native anchor-scroll can fire before the page
  // body is painted; this re-runs the scroll after the next animation
  // frame so the heading lands below the sticky topbar (which already
  // has scroll-margin-top via .help-prose).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const scrollToHash = () => {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return
      const el = document.getElementById(hash)
      if (!el) return
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'start' })
      })
    }
    scrollToHash()
    window.addEventListener('hashchange', scrollToHash)
    return () => window.removeEventListener('hashchange', scrollToHash)
  }, [activeSlug])

  // Ref to the nav element — used by the arrow-key handler to find all
  // tab-stop elements (chevron buttons + topic anchors + sub-section
  // anchors) and move focus between them.
  const navRef = useRef<HTMLElement | null>(null)
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const root = navRef.current
    if (!root) return
    const target = e.target as HTMLElement
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = Array.from(
        root.querySelectorAll<HTMLElement>('[data-help-nav-item="true"]'),
      )
      const idx = items.indexOf(target)
      if (idx === -1) return
      e.preventDefault()
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(items.length - 1, idx + 1)
          : Math.max(0, idx - 1)
      items[nextIdx]?.focus()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // Only operates on chevron buttons. Right opens, Left collapses.
      const slug = target.getAttribute('data-help-topic-slug')
      if (!slug) return
      if (e.key === 'ArrowRight' && !expanded.has(slug)) {
        e.preventDefault()
        toggle(slug)
      } else if (e.key === 'ArrowLeft' && expanded.has(slug)) {
        e.preventDefault()
        toggle(slug)
      }
    }
  }

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
            ref={navRef}
            aria-label="Help topics"
            className="sticky top-[57px] px-4 py-6 space-y-1"
            onKeyDown={handleNavKeyDown}
          >
            <button
              type="button"
              onClick={toggleAll}
              className="block px-3 py-1 text-[12px] text-[#9ca3af] hover:text-[#e5e7eb] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3a86ff] rounded"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">
              Topics
            </h2>
            <ul className="space-y-0.5">
              {HELP_PAGES.map(p => {
                const active = p.slug === activeSlug
                const isOpen = expanded.has(p.slug)
                const sections = sectionsByPage.get(p.slug) ?? []
                const hasSections = sections.length > 0
                const rowBaseCls = active
                  ? 'bg-[#1e2530] text-[#f3f4f6] border-l-2 border-[#f3f4f6] font-medium'
                  : 'text-[#9ca3af] hover:bg-[#1e2126] hover:text-[#e5e7eb] border-l-2 border-transparent'
                return (
                  <li key={p.slug}>
                    <div className={`flex items-stretch rounded-r-md ${rowBaseCls}`}>
                      {hasSections ? (
                        <button
                          type="button"
                          aria-label={isOpen ? `Collapse ${p.title}` : `Expand ${p.title}`}
                          aria-expanded={isOpen}
                          data-help-nav-item="true"
                          data-help-topic-slug={p.slug}
                          onClick={() => toggle(p.slug)}
                          className="flex items-center justify-center w-7 flex-none text-[#6b7280] hover:text-[#e5e7eb] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3a86ff] rounded-l-md"
                        >
                          <ChevronRightIcon
                            className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        <span className="w-7 flex-none" aria-hidden="true" />
                      )}
                      <Link
                        href={`/help/${p.slug}`}
                        data-help-nav-item="true"
                        className="flex-1 min-w-0 pr-3 py-2 text-[14px] leading-[1.45] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3a86ff] rounded-r-md"
                      >
                        {p.title}
                      </Link>
                    </div>
                    {hasSections && isOpen && (
                      <ul className="mt-0.5 mb-1 ml-7 border-l border-[#23262d] pl-2 space-y-0.5">
                        {sections.map(section => (
                          <li key={section.slug}>
                            <Link
                              href={`/help/${p.slug}#${section.slug}`}
                              data-help-nav-item="true"
                              className="block px-2 py-1 text-[13px] leading-[1.4] text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#1e2126] rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3a86ff]"
                            >
                              {section.heading}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
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
