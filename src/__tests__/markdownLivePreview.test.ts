/**
 * markdownLivePreview.test.ts
 *
 * Verifies that the StateField-based live preview plugin produces the correct
 * DecorationSet for common markdown constructs.
 *
 * These tests run in Node.js (via jest-environment-jsdom) using the real
 * CodeMirror packages — no browser DOM is required for StateField testing.
 */

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { markdownLivePreview, markdownLivePreviewField } from '../components/editor/markdownLivePreview'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ base: markdownLanguage }),
      markdownLivePreview,
    ],
  })
}

/** Iterate the decoration set and return plain objects for easy assertion. */
function collectDecos(state: EditorState): Array<{ from: number; to: number; class: string }> {
  const decos = state.field(markdownLivePreviewField)
  const result: Array<{ from: number; to: number; class: string }> = []
  const cursor = decos.iter()
  while (cursor.value !== null) {
    const cls: string =
      cursor.value.spec?.class ??
      cursor.value.spec?.attributes?.class ??
      cursor.value.spec?.attributes?.style ??
      '(unknown)'
    result.push({ from: cursor.from, to: cursor.to, class: cls })
    cursor.next()
  }
  return result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('markdownLivePreview StateField', () => {
  test('produces a h1 line decoration for ATX heading 1', () => {
    const state = makeState('# Hello World\n')
    const decos = collectDecos(state)

    // Should have a line decoration (from === to === 0) for the heading
    const lineDeco = decos.find(d => d.from === 0 && d.to === 0)
    expect(lineDeco).toBeDefined()
    expect(lineDeco!.class).toBe('cm-lp-h1')
  })

  test('hides the # HeaderMark when cursor is not on the heading line', () => {
    // Cursor is on line 3 (position after the two newlines)
    const doc = '# Hello World\n\nSome text'
    const state = makeState(doc, doc.length) // cursor at end
    const decos = collectDecos(state)

    // The '#' marker is at positions [0, 1]
    const hiddenMark = decos.find(d => d.from === 0 && d.to === 1)
    expect(hiddenMark).toBeDefined()
    expect(hiddenMark!.class).toBe('cm-lp-hidden')
  })

  test('does NOT hide HeaderMark when cursor is on the same heading line', () => {
    // Cursor is at position 5 — inside the heading line
    const doc = '# Hello World\n\nSome text'
    const state = makeState(doc, 5)
    const decos = collectDecos(state)

    const hiddenMark = decos.find(d => d.from === 0 && d.to === 1 && d.class === 'cm-lp-hidden')
    expect(hiddenMark).toBeUndefined()
  })

  test('produces a h2 line decoration for ATX heading 2', () => {
    const doc = 'Normal line\n\n## Section'
    const state = makeState(doc, 0) // cursor on line 1
    const decos = collectDecos(state)

    const h2LineStart = doc.indexOf('## Section')
    const lineDeco = decos.find(d => d.from === h2LineStart && d.to === h2LineStart)
    expect(lineDeco).toBeDefined()
    expect(lineDeco!.class).toBe('cm-lp-h2')
  })

  test('applies bold mark to content between ** markers', () => {
    const doc = '**bold text**\n'
    // Cursor on line 2 so markers get hidden
    const state = makeState(doc, doc.length - 1)
    const decos = collectDecos(state)

    // Bold mark should cover "bold text" (positions 2–11)
    const boldDeco = decos.find(d => d.class === 'cm-lp-bold')
    expect(boldDeco).toBeDefined()
    expect(boldDeco!.from).toBe(2)
    expect(boldDeco!.to).toBe(11)
  })

  test('applies italic mark to content between * markers', () => {
    const doc = '*italic text*\n'
    const state = makeState(doc, doc.length - 1)
    const decos = collectDecos(state)

    const italicDeco = decos.find(d => d.class === 'cm-lp-italic')
    expect(italicDeco).toBeDefined()
    expect(italicDeco!.from).toBe(1)
    expect(italicDeco!.to).toBe(12)
  })

  test('hides ** markers when cursor is not on that line', () => {
    const doc = '**bold**\n\nother line'
    const state = makeState(doc, doc.length) // cursor on line 3
    const decos = collectDecos(state)

    // Opening ** at [0,2] and closing ** at [6,8] should both be hidden
    const openHidden = decos.find(d => d.from === 0 && d.to === 2 && d.class === 'cm-lp-hidden')
    const closeHidden = decos.find(d => d.from === 6 && d.to === 8 && d.class === 'cm-lp-hidden')
    expect(openHidden).toBeDefined()
    expect(closeHidden).toBeDefined()
  })

  test('does not crash or throw on empty document', () => {
    expect(() => makeState('')).not.toThrow()
  })

  test('does not crash on complex mixed content', () => {
    const doc = `# Heading 1\n\n## Heading 2\n\n**bold** and *italic* and \`code\`\n\n~~strike~~\n`
    expect(() => makeState(doc)).not.toThrow()
    const state = makeState(doc, 0)
    const decos = collectDecos(state)
    expect(decos.length).toBeGreaterThan(0)
  })

  test('decorations update after a transaction (docChanged)', () => {
    const doc = 'plain text'
    const state1 = makeState(doc)
    const decos1 = collectDecos(state1)
    expect(decos1.length).toBe(0)

    // Add a heading
    const tr = state1.update({
      changes: { from: 0, to: 0, insert: '# ' },
    })
    const decos2 = collectDecos(tr.state)
    const headingDeco = decos2.find(d => d.class === 'cm-lp-h1')
    expect(headingDeco).toBeDefined()
  })

  test('styles a list marker as soon as space is typed (no content yet)', () => {
    // User just typed `1. ` — lezer-markdown does not consider this a
    // ListItem until there is content, so the fallback regex pass must fire.
    const doc = '1. '
    const state = makeState(doc, doc.length)
    const decos = collectDecos(state)

    const lineDeco = decos.find(d => d.from === 0 && d.to === 0 && d.class === 'cm-lp-list')
    expect(lineDeco).toBeDefined()
    const markDeco = decos.find(d => d.from === 0 && d.to === 2 && d.class === 'cm-lp-list-mark')
    expect(markDeco).toBeDefined()
  })

  test('styles a bullet marker (`- `) as soon as space is typed', () => {
    const doc = '- '
    const state = makeState(doc, doc.length)
    const decos = collectDecos(state)

    expect(decos.find(d => d.from === 0 && d.to === 0 && d.class === 'cm-lp-list')).toBeDefined()
    expect(decos.find(d => d.from === 0 && d.to === 1 && d.class === 'cm-lp-list-mark')).toBeDefined()
  })

  test('does NOT style a list-marker-like sequence inside a fenced code block', () => {
    const doc = '```\n1. not a list\n```\n'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)

    // No list-mark deco anywhere inside the code fence.
    const markInside = decos.find(d => d.class === 'cm-lp-list-mark')
    expect(markInside).toBeUndefined()
  })

  test('StateField is registered with EditorView.decorations facet', () => {
    // The plugin is a StateField, verify it participates in EditorView.decorations
    // by checking its `provide` property produces the right facet provider.
    // We verify indirectly: the field value should appear in the decoration facet.
    const doc = '# Title\n'
    const state = makeState(doc)

    // The facet value includes our StateField's output (not a function)
    const facetValues = state.facet(EditorView.decorations)
    // At least one entry should be our DecorationSet (not a function)
    const hasDirectDecoSet = facetValues.some(v => typeof v !== 'function')
    expect(hasDirectDecoSet).toBe(true)
  })
})

// ── Task-marker click handler ────────────────────────────────────────────────
//
// Mounts a real EditorView in jsdom and clicks the task-marker span to
// exercise the mousedown handler end-to-end. Date logic is fixed via
// jest.useFakeTimers so the ✅ stamp is deterministic.

describe('task marker click handler', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 18, 12, 0)) // 2026-05-18
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function mountView(doc: string): { view: EditorView; parent: HTMLElement } {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage }), markdownLivePreview],
      }),
    })
    return { view, parent }
  }

  function clickMarker(parent: HTMLElement, selector: string): boolean {
    const marker = parent.querySelector(selector) as HTMLElement | null
    if (!marker) return false
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    marker.dispatchEvent(evt)
    return true
  }

  test('clicking an unchecked `[ ]` marker checks it and stamps today\'s date', () => {
    const { view, parent } = mountView('- [ ] buy milk')
    const clicked = clickMarker(parent, '.cm-lp-task-unchecked')
    expect(clicked).toBe(true)
    expect(view.state.doc.toString()).toBe('- [x] buy milk ✅ 2026-05-18')
    view.destroy()
    parent.remove()
  })

  test('clicking a checked `[x]` marker unchecks it and strips the ✅ date', () => {
    const { view, parent } = mountView('- [x] buy milk ✅ 2026-05-18')
    const clicked = clickMarker(parent, '.cm-lp-task-checked')
    expect(clicked).toBe(true)
    expect(view.state.doc.toString()).toBe('- [ ] buy milk')
    view.destroy()
    parent.remove()
  })

  test('clicking outside a task marker does not modify the document', () => {
    const original = 'just a plain line'
    const { view, parent } = mountView(original)
    // Click on the line wrapper, not a task marker
    const someLine = parent.querySelector('.cm-line') as HTMLElement | null
    expect(someLine).not.toBeNull()
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    someLine!.dispatchEvent(evt)
    expect(view.state.doc.toString()).toBe(original)
    view.destroy()
    parent.remove()
  })

  test('click with Shift modifier is ignored (so range selection still works)', () => {
    const { view, parent } = mountView('- [ ] foo')
    const marker = parent.querySelector('.cm-lp-task-unchecked') as HTMLElement | null
    expect(marker).not.toBeNull()
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true })
    marker!.dispatchEvent(evt)
    // Doc unchanged because the handler bails on modifier clicks
    expect(view.state.doc.toString()).toBe('- [ ] foo')
    view.destroy()
    parent.remove()
  })

  test('clicking a recurring task checkbox produces TWO lines (new open instance above, completed below)', () => {
    // Fixed date: 2026-05-18 (from beforeEach).
    // Due date 2026-05-20, rule "every week" → next due 2026-05-27.
    const { view, parent } = mountView('- [ ] water plants 🔁 every week 📅 2026-05-20')
    const clicked = clickMarker(parent, '.cm-lp-task-unchecked')
    expect(clicked).toBe(true)
    const doc = view.state.doc.toString()
    const lines = doc.split('\n')
    expect(lines).toHaveLength(2)
    // New open instance: date rolled forward one week, canonical marker order.
    expect(lines[0]).toBe('- [ ] water plants 📅 2026-05-27 🔁 every week')
    // Completed line: original due date preserved, ✅ stamped with today (2026-05-18).
    expect(lines[1]).toContain('- [x]')
    expect(lines[1]).toContain('📅 2026-05-20')
    expect(lines[1]).toContain('🔁 every week')
    expect(lines[1]).toContain('✅ 2026-05-18')
    view.destroy()
    parent.remove()
  })

  test('recurring task: new instance appears ABOVE the completed line in a multi-line doc', () => {
    const doc = 'Intro\n- [ ] water plants 🔁 every week 📅 2026-05-20\nOutro'
    const { view, parent } = mountView(doc)
    clickMarker(parent, '.cm-lp-task-unchecked')
    const result = view.state.doc.toString()
    const lines = result.split('\n')
    // Expect 4 lines: Intro, new-open, completed, Outro
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('Intro')
    expect(lines[1]).toContain('- [ ]')
    expect(lines[1]).toContain('📅 2026-05-27')
    expect(lines[2]).toContain('- [x]')
    expect(lines[2]).toContain('✅ 2026-05-18')
    expect(lines[3]).toBe('Outro')
    view.destroy()
    parent.remove()
  })
})
