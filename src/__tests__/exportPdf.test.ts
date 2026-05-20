/**
 * exportPdf.test.ts
 *
 * Coverage for the printable-HTML builder. The print-window side
 * effect (openPrintWindow) is exercised indirectly via Jest's jsdom
 * stub of window.open so we can verify the doc was written; the
 * builder itself is the bulk of the behaviour and gets the heavier
 * coverage here.
 */

import { buildPrintableHtml, openPrintWindow } from '../utils/export'
import type { Note } from '@/types'

const note = (overrides: Partial<Note> & { id: string; title: string; content: string }): Note => ({
  folderId: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  isDeleted: false,
  deletedAt: null,
  isPinned: false,
  templateId: null,
  ...overrides,
})

test('single-note doc has no page-break (no blank leading page)', () => {
  const html = buildPrintableHtml(
    [note({ id: '1', title: 'Solo', content: 'Hi' })],
    true,
    'doc',
  )
  // The very first section gets no page-break class.
  expect(html).toContain('<section>')
  expect(html).not.toContain('<section class="page-break">\n  <h1>Solo')
})

test('multi-note doc page-breaks between notes', () => {
  const html = buildPrintableHtml(
    [
      note({ id: '1', title: 'First', content: 'a' }),
      note({ id: '2', title: 'Second', content: 'b' }),
      note({ id: '3', title: 'Third', content: 'c' }),
    ],
    true,
    'doc',
  )
  // First section: no page-break. Subsequent ones: page-break.
  const sections = html.match(/<section[^>]*>/g) ?? []
  expect(sections.length).toBe(3)
  expect(sections[0]).toBe('<section>')
  expect(sections[1]).toBe('<section class="page-break">')
  expect(sections[2]).toBe('<section class="page-break">')
})

test('escapes HTML in title and body — no script injection', () => {
  const html = buildPrintableHtml(
    [note({
      id: '1',
      title: '<script>alert(1)</script>',
      content: '<img src=x onerror=alert(1)>',
    })],
    true,
    'doc',
  )
  // The raw < / > characters must not survive to the output.
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).not.toContain('<img src=x')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('&lt;img src=x')
})

test('omits tags section when includeTags is false', () => {
  const html = buildPrintableHtml(
    [note({ id: '1', title: 'T', content: '#alpha #beta body' })],
    false,
    'doc',
  )
  expect(html).not.toContain('class="tag"')
})

test('includes tags as styled chips when includeTags is true', () => {
  const html = buildPrintableHtml(
    [note({ id: '1', title: 'T', content: '#alpha #beta body' })],
    true,
    'doc',
  )
  expect(html).toContain('class="tag"')
  expect(html).toContain('#alpha')
  expect(html).toContain('#beta')
})

test('untitled fallback for blank title', () => {
  const html = buildPrintableHtml(
    [note({ id: '1', title: '', content: 'body' })],
    true,
    'doc',
  )
  expect(html).toContain('(untitled)')
})

test('document title is escaped', () => {
  const html = buildPrintableHtml(
    [note({ id: '1', title: 'a', content: 'b' })],
    true,
    '<dangerous>',
  )
  // The title in <title>...</title> must be HTML-encoded.
  expect(html).toMatch(/<title>&lt;dangerous&gt;<\/title>/)
})

test('openPrintWindow writes the html into a new window', () => {
  // jsdom provides a partial window.open implementation. Stub document.write
  // / document.close so we can capture what was passed.
  const written: string[] = []
  const fakeWin = {
    document: {
      open: jest.fn(),
      write: (s: string) => { written.push(s) },
      close: jest.fn(),
    },
    focus: jest.fn(),
    print: jest.fn(),
    onload: null as null | (() => void),
  } as unknown as Window
  const origOpen = window.open
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).open = jest.fn(() => fakeWin)
  try {
    const w = openPrintWindow('<html></html>')
    expect(w).toBe(fakeWin)
    expect(written).toEqual(['<html></html>'])
  } finally {
    window.open = origOpen
  }
})

test('openPrintWindow returns null when popup is blocked', () => {
  const origAlert = window.alert
  const origOpen = window.open
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).open = jest.fn(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).alert = jest.fn()
  try {
    const w = openPrintWindow('<html></html>')
    expect(w).toBeNull()
    expect(window.alert).toHaveBeenCalled()
  } finally {
    window.open = origOpen
    window.alert = origAlert
  }
})
