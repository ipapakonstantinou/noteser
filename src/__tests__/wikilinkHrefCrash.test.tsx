/**
 * wikilinkHrefCrash.test.tsx
 *
 * `[x](wikilink://%)` in a note body reached `decodeWikilinkHref`, whose
 * `decodeURIComponent` threw a URIError mid-render. With no error boundary
 * anywhere in the app, that unmounted the whole React tree — and since the note
 * is still in the vault after a reload, the app came back broken.
 *
 * Two halves, and the second is the one that matters: the decoder is total, and
 * a throw inside the renderer is contained.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { decodeWikilinkHref, encodeWikilinkHref } from '../utils/wikilinkTarget'
import { RenderErrorBoundary } from '../components/shared/RenderErrorBoundary'

describe('decodeWikilinkHref is total', () => {
  test.each([
    ['a bare percent', 'wikilink://%'],
    ['a malformed escape', 'wikilink://%zz'],
    ['a truncated escape', 'wikilink://%E0%A4'],
    ['a malformed fragment', 'wikilink://Note?frag=%'],
  ])('does not throw on %s', (_label, href) => {
    expect(() => decodeWikilinkHref(href)).not.toThrow()
    expect(decodeWikilinkHref(href)).not.toBeNull()
  })

  test('falls back to the raw text it could not decode', () => {
    expect(decodeWikilinkHref('wikilink://%')).toEqual({ title: '%', fragment: null })
    expect(decodeWikilinkHref('wikilink://Note?frag=%')).toEqual({ title: 'Note', fragment: '%' })
  })

  test('still round-trips a normal link', () => {
    const href = encodeWikilinkHref('My Note', 'Some Heading')
    expect(decodeWikilinkHref(href)).toEqual({ title: 'My Note', fragment: 'Some Heading' })
  })

  test('a non-wikilink href is still null', () => {
    expect(decodeWikilinkHref('https://example.com')).toBeNull()
  })
})

describe('RenderErrorBoundary', () => {
  // React logs the caught error; silence it so the suite output stays readable.
  let errSpy: jest.SpyInstance
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  const Boom = (): React.ReactElement => { throw new Error('URI malformed') }

  test('contains a throw and keeps the note readable as raw text', () => {
    render(
      <RenderErrorBoundary key="note-1" fallbackContent="- [ ] my raw body">
        <Boom />
      </RenderErrorBoundary>,
    )

    expect(screen.getByTestId('render-error-fallback')).toBeInTheDocument()
    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument()
    expect(screen.getByText('- [ ] my raw body')).toBeInTheDocument()
  })

  test('renders children normally when nothing throws', () => {
    render(
      <RenderErrorBoundary key="note-1">
        <p>fine</p>
      </RenderErrorBoundary>,
    )

    expect(screen.getByText('fine')).toBeInTheDocument()
    expect(screen.queryByTestId('render-error-fallback')).not.toBeInTheDocument()
  })

  test('switching notes clears a caught error instead of latching it', () => {
    // The reset IS the key: React remounts on a changed key and the caught error
    // goes with the old instance. EditorContent passes the note id.
    const { rerender } = render(
      <RenderErrorBoundary key="bad-note"><Boom /></RenderErrorBoundary>,
    )
    expect(screen.getByTestId('render-error-fallback')).toBeInTheDocument()

    rerender(
      <RenderErrorBoundary key="good-note"><p>fine</p></RenderErrorBoundary>,
    )

    expect(screen.queryByTestId('render-error-fallback')).not.toBeInTheDocument()
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})
