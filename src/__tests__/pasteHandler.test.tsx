/**
 * @jest-environment jsdom
 *
 * Covers the CodeMirror `paste` DOM handler built inside CodeMirrorEditor —
 * the half of the paste-URL-as-titled-link feature that pasteLink.test.ts
 * (pure helpers) does not reach, plus the `pasteUrlAsLink` toggle (#300).
 *
 * @uiw/react-codemirror is stubbed so jsdom never mounts a real CM view; we
 * capture the `extensions` prop the editor builds and call the paste handler
 * against a headless EditorView.
 */

import { render } from '@testing-library/react'

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Capture the extensions array the editor hands to CodeMirror.
let capturedExtensions: unknown[] = []
jest.mock('@uiw/react-codemirror', () => {
  const React = require('react')
  const Stub = React.forwardRef((props: { extensions?: unknown[] }, ref: unknown) => {
    capturedExtensions = props.extensions ?? []
    React.useImperativeHandle(ref, () => ({ view: undefined }))
    return React.createElement('div', { 'data-testid': 'cm-stub' })
  })
  Stub.displayName = 'CodeMirrorStub'
  return { __esModule: true, default: Stub }
})

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CodeMirrorEditor } from '../components/editor/CodeMirrorEditor'
import { useSettingsStore } from '../stores/settingsStore'

type PasteHandler = (event: ClipboardEvent, view: EditorView) => boolean

const URL_ = 'https://site.com/602541'

// EditorView.domEventHandlers() returns a ViewPlugin that carries its handler
// map on `.domEventHandlers` — dig the paste one out of the extension tree.
function pasteHandler(): PasteHandler {
  for (const ext of (capturedExtensions as unknown[]).flat(Infinity)) {
    const handlers = (ext as { domEventHandlers?: Record<string, unknown> })?.domEventHandlers
    if (handlers && typeof handlers.paste === 'function') return handlers.paste as PasteHandler
  }
  throw new Error('no paste handler in the editor extensions')
}

function pasteEvent(text: string, html = ''): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
    },
  })
  return event
}

function makeView(doc: string, selection?: { anchor: number; head: number }): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: selection ?? { anchor: doc.length } }),
  })
}

let fetchMock: jest.Mock

beforeEach(() => {
  capturedExtensions = []
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ title: 'Page Title' }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  useSettingsStore.setState({ pasteUrlAsLink: true })
  render(
    <CodeMirrorEditor
      noteId="n1"
      initialContent=""
      activeNotes={[]}
      onSave={() => {}}
      onWikilinkNavigate={() => {}}
    />,
  )
})

afterEach(() => {
  useSettingsStore.setState({ pasteUrlAsLink: true })
})

describe('paste handler — pasteUrlAsLink ON (default)', () => {
  test('a bare URL becomes a titled-link placeholder and fetches the title', () => {
    const view = makeView('')
    const handled = pasteHandler()(pasteEvent(URL_), view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe(`[Fetching title…](${URL_})`)
    expect(fetchMock).toHaveBeenCalledWith(`/api/link-title?url=${encodeURIComponent(URL_)}`)
  })

  test('a clipboard HTML anchor supplies the title without a network call', () => {
    const view = makeView('')
    const handled = pasteHandler()(pasteEvent(URL_, `<a href="${URL_}">Site name</a>`), view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe(`[Site name](${URL_})`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('paste handler — pasteUrlAsLink OFF', () => {
  beforeEach(() => {
    useSettingsStore.setState({ pasteUrlAsLink: false })
  })

  test('a bare URL falls through to the default paste (verbatim, no fetch)', () => {
    const view = makeView('')
    const handled = pasteHandler()(pasteEvent(URL_), view)
    expect(handled).toBe(false)
    expect(view.state.doc.toString()).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a clipboard HTML anchor also falls through', () => {
    const view = makeView('')
    const handled = pasteHandler()(pasteEvent(URL_, `<a href="${URL_}">Site name</a>`), view)
    expect(handled).toBe(false)
    expect(view.state.doc.toString()).toBe('')
  })

  test('pasting over a SELECTION still wraps it — the user chose the text', () => {
    const view = makeView('my site', { anchor: 0, head: 7 })
    const handled = pasteHandler()(pasteEvent(URL_), view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe(`[my site](${URL_})`)
  })
})
