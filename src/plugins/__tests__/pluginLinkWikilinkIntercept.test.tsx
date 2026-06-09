/**
 * Click intercept on plugin-rendered `<a href="wikilink://...">`.
 *
 * A plugin emits a `{ tag: 'link', href: { kind: 'note', noteId } }`
 * VNode; the renderer turns that into an anchor with a
 * `wikilink://<encodedId>` href. Browser navigation to an unrecognised
 * scheme is a no-op, so the renderer must intercept the click and
 * dispatch the host's `useWorkspaceStore.openNote(noteId)` action.
 *
 * Tests:
 *   - Primary-button click on a note link calls openNote with the
 *     noteId off the typed shape (not from URL parsing).
 *   - Modifier-clicks (cmd / ctrl / shift / alt) are NOT intercepted —
 *     the user's intent is "follow the URL natively", which is a no-op
 *     for `wikilink://` but we don't pretend otherwise.
 *   - Anchor (`#fragment`) links are not intercepted; the browser's
 *     native fragment-scroll handles them.
 *
 * Documented in `docs/plugins-v1.2-impl-notes.md` under "Post-v1.2:
 * VNode event delivery + wikilink intercept".
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import { PluginNode } from '@/plugins/PluginVNode'
import { useWorkspaceStore } from '@/stores/workspaceStore'

describe('plugin link — wikilink click intercept', () => {
  let openNoteSpy: jest.Mock
  let originalOpenNote: ReturnType<typeof useWorkspaceStore.getState>['openNote']
  beforeEach(() => {
    originalOpenNote = useWorkspaceStore.getState().openNote
    openNoteSpy = jest.fn()
    useWorkspaceStore.setState({ openNote: openNoteSpy })
  })
  afterEach(() => {
    useWorkspaceStore.setState({ openNote: originalOpenNote })
  })

  test('plain click on a wikilink dispatches openNote(noteId)', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Open note',
          href: { kind: 'note', noteId: 'note-123' },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Open note' })
    expect(link.getAttribute('href')).toBe('wikilink://note-123')

    fireEvent.click(link, { button: 0 })

    expect(openNoteSpy).toHaveBeenCalledTimes(1)
    expect(openNoteSpy).toHaveBeenCalledWith('note-123')
  })

  test('the noteId comes from the typed shape, not URL decoding', () => {
    // A noteId with characters that need percent-encoding round-trips
    // unchanged through openNote — the click path never decodes the URL.
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Open',
          href: { kind: 'note', noteId: 'has space and / slash' },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    fireEvent.click(link, { button: 0 })
    expect(openNoteSpy).toHaveBeenCalledWith('has space and / slash')
  })

  test('cmd/ctrl/shift/alt-click is not intercepted', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Open',
          href: { kind: 'note', noteId: 'abc' },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    fireEvent.click(link, { button: 0, metaKey: true })
    fireEvent.click(link, { button: 0, ctrlKey: true })
    fireEvent.click(link, { button: 0, shiftKey: true })
    fireEvent.click(link, { button: 0, altKey: true })
    expect(openNoteSpy).not.toHaveBeenCalled()
  })

  test('anchor (#fragment) links are not intercepted', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Jump',
          href: { kind: 'anchor', fragment: 'section-1' },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Jump' })
    expect(link.getAttribute('href')).toBe('#section-1')

    fireEvent.click(link, { button: 0 })

    // No openNote dispatch — the browser's native fragment-scroll owns
    // this case.
    expect(openNoteSpy).not.toHaveBeenCalled()
  })

  test('preventDefault is called for wikilink clicks (browser navigation suppressed)', () => {
    render(
      <PluginNode
        node={{
          tag: 'link',
          label: 'Open',
          href: { kind: 'note', noteId: 'abc' },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    // fireEvent.click returns false when a handler called preventDefault.
    const notPrevented = fireEvent.click(link, { button: 0 })
    expect(notPrevented).toBe(false)
  })
})
