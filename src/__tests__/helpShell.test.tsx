/**
 * helpShell.test.tsx
 *
 * Smoke test for the /help layout chrome. Asserts:
 *   - sidebar renders the topic list
 *   - content children render
 *   - no theme toggle (the route inherits the main app dark theme —
 *     guard against the toggle creeping back in)
 *   - the active topic auto-expands and surfaces its sub-section links
 *   - clicking a chevron toggles its sub-section list
 *   - non-active topics start collapsed
 *
 * The HelpShell no longer carries a per-help theme; it inherits the
 * root <html class="dark"> set in src/app/layout.tsx.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { HelpShell } from '../app/help/HelpShell'
import { HELP_PAGES } from '../help/content'
import { parseHelpBody } from '../help/sections'

beforeEach(() => {
  window.localStorage.clear()
  // jsdom keeps the hash across tests in the same window.
  window.history.replaceState(null, '', '/')
})

const firstPage = HELP_PAGES[0]

describe('HelpShell', () => {
  test('renders sidebar topics and child content', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <p>article-body-marker</p>
      </HelpShell>
    )

    expect(screen.getByRole('navigation', { name: /help topics/i })).toBeInTheDocument()
    expect(screen.getByText('article-body-marker')).toBeInTheDocument()
    for (const p of HELP_PAGES) {
      expect(screen.getByRole('link', { name: p.title })).toBeInTheDocument()
    }
  })

  test('does not render a theme toggle button', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )
    expect(screen.queryByRole('button', { name: /toggle theme/i })).not.toBeInTheDocument()
  })

  test('does not write a help-theme key to localStorage on mount', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )
    expect(window.localStorage.getItem('noteser-help-theme')).toBeNull()
  })

  test('auto-expands the active topic and renders its sub-section links', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )
    const sections = parseHelpBody(firstPage.body).sections
    for (const s of sections) {
      const link = screen.getByRole('link', { name: s.heading })
      expect(link).toHaveAttribute('href', `/help/${firstPage.slug}#${s.slug}`)
    }
  })

  test('non-active topics start collapsed; clicking the chevron expands them', () => {
    // Find a non-active page that has sub-sections.
    const other = HELP_PAGES.find(
      p => p.slug !== firstPage.slug && parseHelpBody(p.body).sections.length > 0,
    )
    if (!other) throw new Error('Expected a second help page with sub-sections for this test')
    const otherSections = parseHelpBody(other.body).sections

    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )

    // Sub-section link for the non-active topic is NOT in the doc yet.
    expect(screen.queryByRole('link', { name: otherSections[0].heading })).not.toBeInTheDocument()

    // Click that topic's chevron.
    const chevron = screen.getByRole('button', { name: new RegExp(`expand ${other.title}`, 'i') })
    fireEvent.click(chevron)

    // Now the sub-section links surface.
    const link = screen.getByRole('link', { name: otherSections[0].heading })
    expect(link).toHaveAttribute('href', `/help/${other.slug}#${otherSections[0].slug}`)
  })

  test('clicking the chevron of the active topic collapses it', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )
    const firstSection = parseHelpBody(firstPage.body).sections[0]
    expect(screen.getByRole('link', { name: firstSection.heading })).toBeInTheDocument()

    const chevron = screen.getByRole('button', {
      name: new RegExp(`collapse ${firstPage.title}`, 'i'),
    })
    fireEvent.click(chevron)
    expect(screen.queryByRole('link', { name: firstSection.heading })).not.toBeInTheDocument()
  })

  test('Expand all toggle opens every topic with sub-sections; clicking again collapses them', () => {
    render(
      <HelpShell activeSlug={firstPage.slug}>
        <div />
      </HelpShell>
    )

    // Default label is "Expand all" because only the active topic is open.
    const button = screen.getByRole('button', { name: /^expand all$/i })
    expect(button).toBeInTheDocument()

    fireEvent.click(button)

    // After clicking, every topic with sub-sections should now show its
    // first section link in the nav.
    const expandable = HELP_PAGES.filter(
      p => parseHelpBody(p.body).sections.length > 0,
    )
    for (const p of expandable) {
      const firstSection = parseHelpBody(p.body).sections[0]
      const link = screen.getByRole('link', { name: firstSection.heading })
      expect(link).toHaveAttribute('href', `/help/${p.slug}#${firstSection.slug}`)
    }

    // Label flipped to "Collapse all".
    const collapseButton = screen.getByRole('button', { name: /^collapse all$/i })
    fireEvent.click(collapseButton)

    // Now every sub-section link is gone.
    for (const p of expandable) {
      const firstSection = parseHelpBody(p.body).sections[0]
      expect(screen.queryByRole('link', { name: firstSection.heading })).not.toBeInTheDocument()
    }

    // And the button is back to "Expand all".
    expect(screen.getByRole('button', { name: /^expand all$/i })).toBeInTheDocument()
  })
})
