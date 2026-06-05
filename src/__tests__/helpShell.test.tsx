/**
 * helpShell.test.tsx
 *
 * Smoke test for the /help layout chrome (hp1). Asserts:
 *   - sidebar renders the topic list
 *   - content children render
 *   - theme toggle button is present with the right accessible name
 *   - default theme is dark (data-help-theme="dark" with no localStorage)
 *   - clicking the toggle swaps to light and persists under
 *     `noteser-help-theme`
 *
 * The HelpShell is /help-scoped and intentionally independent from the
 * main app theme — these assertions guarantee that contract.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpShell } from '../app/help/HelpShell'
import { HELP_PAGES } from '../help/content'

beforeEach(() => {
  window.localStorage.clear()
})

const firstPage = HELP_PAGES[0]

describe('HelpShell', () => {
  test('renders sidebar topics and child content', () => {
    render(
      <HelpShell activeSlug={firstPage.slug} page={firstPage}>
        <p>article-body-marker</p>
      </HelpShell>
    )

    expect(screen.getByRole('navigation', { name: /help topics/i })).toBeInTheDocument()
    expect(screen.getByText('article-body-marker')).toBeInTheDocument()
    // Every help page title is in the sidebar.
    for (const p of HELP_PAGES) {
      expect(screen.getByRole('link', { name: p.title })).toBeInTheDocument()
    }
  })

  test('exposes a "Toggle theme" button', () => {
    render(
      <HelpShell activeSlug={firstPage.slug} page={firstPage}>
        <div />
      </HelpShell>
    )
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument()
  })

  test('defaults to dark when no preference is stored', () => {
    const { container } = render(
      <HelpShell activeSlug={firstPage.slug} page={firstPage}>
        <div />
      </HelpShell>
    )
    const shell = container.querySelector('[data-help-theme]')
    expect(shell).toHaveAttribute('data-help-theme', 'dark')
  })

  test('toggling persists to localStorage and flips the data attribute', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <HelpShell activeSlug={firstPage.slug} page={firstPage}>
        <div />
      </HelpShell>
    )

    const toggle = screen.getByRole('button', { name: /toggle theme/i })
    await act(async () => {
      await user.click(toggle)
    })

    const shell = container.querySelector('[data-help-theme]')
    expect(shell).toHaveAttribute('data-help-theme', 'light')
    expect(window.localStorage.getItem('noteser-help-theme')).toBe('light')

    await act(async () => {
      await user.click(toggle)
    })
    expect(shell).toHaveAttribute('data-help-theme', 'dark')
    expect(window.localStorage.getItem('noteser-help-theme')).toBe('dark')
  })

  test('hydrates from a stored light preference', async () => {
    window.localStorage.setItem('noteser-help-theme', 'light')
    const { container } = render(
      <HelpShell activeSlug={firstPage.slug} page={firstPage}>
        <div />
      </HelpShell>
    )
    // Effect runs on mount — wait a tick.
    await act(async () => {
      await Promise.resolve()
    })
    const shell = container.querySelector('[data-help-theme]')
    expect(shell).toHaveAttribute('data-help-theme', 'light')
  })
})
