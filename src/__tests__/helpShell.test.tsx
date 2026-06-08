/**
 * helpShell.test.tsx
 *
 * Smoke test for the /help layout chrome. Asserts:
 *   - sidebar renders the topic list
 *   - content children render
 *   - no theme toggle (the route inherits the main app dark theme)
 *   - the URL hash hook opens the matching <details> on load
 *
 * The HelpShell no longer carries a per-help theme; it inherits the
 * root <html class="dark"> set in src/app/layout.tsx. These tests
 * guard against the toggle creeping back in.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, act } from '@testing-library/react'
import { HelpShell } from '../app/help/HelpShell'
import { HELP_PAGES } from '../help/content'

beforeEach(() => {
  window.localStorage.clear()
  // jsdom keeps the hash across tests in the same window.
  window.history.replaceState(null, '', '/')
})

const firstPage = HELP_PAGES[0]

describe('HelpShell', () => {
  test('renders sidebar topics and child content', () => {
    render(
      <HelpShell activeSlug={firstPage.slug} sectionSlugs={[]}>
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
      <HelpShell activeSlug={firstPage.slug} sectionSlugs={[]}>
        <div />
      </HelpShell>
    )
    expect(screen.queryByRole('button', { name: /toggle theme/i })).not.toBeInTheDocument()
  })

  test('does not write a help-theme key to localStorage on mount', () => {
    render(
      <HelpShell activeSlug={firstPage.slug} sectionSlugs={[]}>
        <div />
      </HelpShell>
    )
    expect(window.localStorage.getItem('noteser-help-theme')).toBeNull()
  })

  test('opens the matching <details> when the URL hash names a known section', async () => {
    window.history.replaceState(null, '', '/help/getting-started#first-note')

    render(
      <HelpShell activeSlug="getting-started" sectionSlugs={['first-note']}>
        <details id="help-section-first-note" data-testid="first-note-details">
          <summary>Your first note</summary>
          <p>body</p>
        </details>
      </HelpShell>
    )

    await act(async () => {
      await Promise.resolve()
    })

    const details = screen.getByTestId('first-note-details') as HTMLDetailsElement
    expect(details.open).toBe(true)
  })

  test('leaves an unknown hash alone (no error, nothing opened)', async () => {
    window.history.replaceState(null, '', '/help/getting-started#not-a-real-section')

    render(
      <HelpShell activeSlug="getting-started" sectionSlugs={['first-note']}>
        <details id="help-section-first-note" data-testid="first-note-details">
          <summary>Your first note</summary>
          <p>body</p>
        </details>
      </HelpShell>
    )

    await act(async () => {
      await Promise.resolve()
    })

    const details = screen.getByTestId('first-note-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
  })
})
