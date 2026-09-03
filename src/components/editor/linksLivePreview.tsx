'use client'

import {
  Decoration, EditorView, WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { StateField, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { findNoteByTitleOrAlias } from '@/utils/aliases'
import { parseWikilinkTarget } from '@/utils/wikilinkTarget'
import type { Note } from '@/types'

// Live-preview link decorations, Obsidian-style.
//
// Renders, inside the CodeMirror editor:
//   1. Bare URLs (http/https)        → clickable autolink, opens in a new tab.
//   2. Autolinks `<http://…>`        → clickable; angle brackets hide off-cursor.
//   3. Markdown links `[text](url)`  → `text` shown as a clickable link, the
//                                       `](url)` machinery hidden off-cursor.
//   4. Wikilinks `[[Target|alias]]`  → clickable internal link; resolves the
//                                       note and opens it (same path as the
//                                       Ctrl+Click handler in CodeMirrorEditor).
//
// Reveal-on-cursor: when the cursor/selection overlaps a link's range we leave
// the raw markdown visible so the user can edit it — exactly how
// imagesLivePreview / markdownLivePreview dodge the caret.
//
// The extension is a FACTORY: it closes over accessors for the active notes +
// the navigate callback so the internal-link widget can resolve and open a note
// without the live-preview layer reaching into React state. CodeMirrorEditor
// passes stable ref-backed accessors, mirroring how its Ctrl+Click handler
// already resolves wikilinks.

export interface LinksLivePreviewDeps {
  /** Snapshot of currently-active (non-deleted) notes for wikilink resolution. */
  getActiveNotes: () => Note[]
  /** Open the resolved note (e.g. the editor's onWikilinkNavigate). */
  onWikilinkNavigate: (note: Note) => void
}

const hidden = Decoration.mark({ class: 'cm-lp-hidden' })

// Open an external URL in a new tab. Centralised so click handlers stay tiny.
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ── Open-on-release bookkeeping (issue #300) ────────────────────────────────
// Links used to navigate on mousedown, so a text selection that started on a
// link navigated away instead of selecting. We record the press and only open
// when the release lands on the SAME link, within a few pixels.

/** How far the pointer may drift between press and release and still count as a click. */
export const LINK_DRAG_SLOP_PX = 4

export interface LinkPress {
  x: number
  y: number
  /** Identity of the pressed link element. */
  el: unknown
}

/** Pure decision: does this release open the link the press started on? */
export function shouldOpenOnRelease(
  press: LinkPress | null,
  release: { x: number; y: number; el: unknown; button: number },
): boolean {
  if (!press || release.button !== 0) return false
  if (release.el == null || release.el !== press.el) return false
  return Math.hypot(release.x - press.x, release.y - press.y) < LINK_DRAG_SLOP_PX
}

// The single in-flight press. Only one pointer can be down on a link at a
// time, so a module-level slot is enough for both the mark handler below and
// the wikilink widget.
let linkPress: LinkPress | null = null

// ── External-link mark (bare URL / autolink / markdown-link text) ────────────
// A plain mark decoration carrying the resolved href in a data attribute; the
// shared mousedown handler reads it and opens the URL.
function externalLinkMark(href: string): Decoration {
  return Decoration.mark({
    class: 'cm-lp-link',
    attributes: { 'data-cm-lp-href': href, title: href },
  })
}

// ── Internal wikilink widget ─────────────────────────────────────────────────
// Replaces the raw `[[Target|alias]]` with a clickable span showing the display
// text. Click resolves the note via the injected accessors and navigates.
class WikilinkWidget extends WidgetType {
  constructor(
    readonly display: string,
    readonly target: string,
    readonly deps: LinksLivePreviewDeps,
  ) {
    super()
  }

  eq(other: WikilinkWidget): boolean {
    return this.display === other.display && this.target === other.target
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-wikilink'
    span.textContent = this.display
    const { title, fragment } = parseWikilinkTarget(this.target)
    const note = findNoteByTitleOrAlias(this.deps.getActiveNotes(), title)
    span.title = note
      ? `Open: ${note.title}${fragment ? ` → ${fragment}` : ''}`
      : `Note not found: ${title}`
    if (!note) span.classList.add('cm-lp-wikilink-missing')
    // mousedown (not click): stop CodeMirror from moving the caret into the
    // widget. Navigation waits for the release (issue #300).
    span.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      linkPress = e.button === 0 ? { x: e.clientX, y: e.clientY, el: span } : null
    })
    span.addEventListener('mouseup', e => {
      const open = shouldOpenOnRelease(linkPress, {
        x: e.clientX, y: e.clientY, el: span, button: e.button,
      })
      linkPress = null
      if (!open) return
      e.preventDefault()
      e.stopPropagation()
      const resolved = findNoteByTitleOrAlias(this.deps.getActiveNotes(), title)
      if (!resolved) return
      this.deps.onWikilinkNavigate(resolved)
      if (fragment) {
        // Defer until the target note's editor mounts, then ask it to scroll.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('noteser:scroll-to-fragment', {
            detail: { noteId: resolved.id, fragment },
          }))
        }, 0)
      }
    })
    return span
  }

  ignoreEvent(): boolean {
    return false
  }
}

// Does the cursor/selection overlap [from, to]? If so we reveal the raw text.
// Inclusive on both ends so the caret resting just before `[` or just after `)`
// counts as "inside" — same feel as Obsidian's reveal.
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

// Match `[[Target]]` / `[[Target|alias]]`. Mirrors renderWikilinks' regex but
// captures positions. No newline inside the target/alias.
const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

function buildDecorations(state: EditorState, deps: LinksLivePreviewDeps): DecorationSet {
  try {
    const { doc } = state
    const specs: [number, number, Decoration][] = []
    // Character ranges already claimed by a wikilink. The lezer pass below
    // skips Link/URL nodes inside these (lezer mis-parses `[[X]]` as a nested
    // `[X]` Link, which we must not double-decorate).
    const wikiRanges: Array<[number, number]> = []

    // ── Wikilink pass (regex over the whole doc) ──────────────────────────────
    const text = doc.toString()
    let wm: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((wm = WIKILINK_RE.exec(text)) !== null) {
      const from = wm.index
      const to = from + wm[0].length
      wikiRanges.push([from, to])
      if (selectionTouches(state, from, to)) continue // reveal raw
      const rawTarget = wm[1]
      const alias = wm[2]
      const display = (alias ?? rawTarget).trim()
      if (!display) continue
      specs.push([from, to, Decoration.replace({
        widget: new WikilinkWidget(display, rawTarget.trim(), deps),
      })])
    }

    const inWikilink = (from: number, to: number): boolean =>
      wikiRanges.some(([wf, wt]) => from >= wf && to <= wt)

    // ── Markdown links / bare URLs / autolinks (lezer tree) ───────────────────
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'Link') {
          if (inWikilink(node.from, node.to)) return false
          // Children: LinkMark `[`, (text), LinkMark `]`, LinkMark `(`, URL,
          // LinkMark `)`. A reference-style link `[text][id]` has no URL/`(`;
          // we only decorate inline links that carry a URL.
          const marks: { from: number; to: number }[] = []
          let urlNode: { from: number; to: number } | null = null
          let child = node.node.firstChild
          while (child) {
            if (child.name === 'LinkMark') marks.push({ from: child.from, to: child.to })
            else if (child.name === 'URL') urlNode = { from: child.from, to: child.to }
            child = child.nextSibling
          }
          if (!urlNode || marks.length < 4) return false
          const openBracket = marks[0]   // `[`
          const closeBracket = marks[1]  // `]`
          const url = doc.sliceString(urlNode.from, urlNode.to)
          const textFrom = openBracket.to
          const textTo = closeBracket.from
          if (textTo <= textFrom) return false // empty link text → leave raw
          if (selectionTouches(state, node.from, node.to)) return false // reveal raw
          // Hide `[`, style the text as a link, hide everything from `]` to `)`.
          specs.push([openBracket.from, openBracket.to, hidden])
          specs.push([textFrom, textTo, externalLinkMark(url)])
          specs.push([closeBracket.from, node.to, hidden])
          return false
        }

        if (node.name === 'Autolink') {
          if (inWikilink(node.from, node.to)) return false
          // `<url>` — URL child plus two LinkMarks (`<` and `>`).
          let urlNode: { from: number; to: number } | null = null
          let child = node.node.firstChild
          while (child) {
            if (child.name === 'URL') urlNode = { from: child.from, to: child.to }
            child = child.nextSibling
          }
          if (!urlNode) return false
          const url = doc.sliceString(urlNode.from, urlNode.to)
          specs.push([urlNode.from, urlNode.to, externalLinkMark(url)])
          if (!selectionTouches(state, node.from, node.to)) {
            specs.push([node.from, urlNode.from, hidden]) // `<`
            specs.push([urlNode.to, node.to, hidden])     // `>`
          }
          return false
        }

        if (node.name === 'URL') {
          // Bare URL — only when it's NOT the child of a Link/Autolink (those
          // are handled above and consume their URL child) and not a wikilink.
          const parent = node.node.parent
          if (parent && (parent.name === 'Link' || parent.name === 'Autolink')) return false
          if (inWikilink(node.from, node.to)) return false
          const url = doc.sliceString(node.from, node.to)
          specs.push([node.from, node.to, externalLinkMark(url)])
          return false
        }
      },
    })

    // RangeSetBuilder needs sorted, non-overlapping ranges. Replace
    // decorations (point/range widgets) sort before marks at the same `from`;
    // CodeMirror requires that ordering via `startSide`, but for our specs the
    // ranges never overlap (wikilink replace spans don't co-occur with the
    // lezer marks because of the inWikilink guard), so a stable sort by
    // [from, to] is enough.
    specs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const builder = new RangeSetBuilder<Decoration>()
    let lastTo = -1
    for (const [from, to, deco] of specs) {
      if (from < lastTo) continue // drop any accidental overlap
      builder.add(from, to, deco)
      lastTo = to
    }
    return builder.finish()
  } catch (e) {
    console.error('[linksLivePreview]', e)
    return Decoration.none
  }
}

export function linksLivePreviewField(deps: LinksLivePreviewDeps): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: state => buildDecorations(state, deps),
    update(decos, tr) {
      // Rebuild on doc/selection change so reveal-on-cursor stays live and
      // async parser updates aren't missed.
      if (tr.docChanged || tr.selection) return buildDecorations(tr.state, deps)
      return decos
    },
    provide: f => EditorView.decorations.from(f),
  })
}

const linksTheme = EditorView.baseTheme({
  '.cm-lp-link': {
    color: 'hsl(217, 88%, 50%)',
    textDecoration: 'underline',
    textDecorationColor: 'hsla(217, 88%, 50%, 0.5)',
    cursor: 'pointer',
  },
  '.cm-lp-link:hover': { textDecorationColor: 'hsl(217, 88%, 50%)' },
  '.cm-lp-wikilink': {
    color: 'hsl(217, 88%, 50%)',
    textDecoration: 'underline',
    textDecorationColor: 'hsla(217, 88%, 50%, 0.5)',
    cursor: 'pointer',
  },
  '.cm-lp-wikilink:hover': { textDecorationColor: 'hsl(217, 88%, 50%)' },
  '.cm-lp-wikilink-missing': { color: '#f87171' },
})

// Shared click handlers for the external-link MARK decorations (bare URLs,
// autolinks, markdown-link text). Wikilink widgets handle their own clicks.
// Plain left-click opens the link — matching Obsidian's live-preview, where a
// rendered link is clickable directly (no modifier needed) — but only on
// RELEASE, so dragging a selection off a link selects instead of navigating.
function linkAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as HTMLElement | null
  return (target?.closest?.('.cm-lp-link') as HTMLElement | null) ?? null
}

const externalLinkClickHandler = EditorView.domEventHandlers({
  mousedown(event) {
    // No preventDefault: CodeMirror still gets to start a selection here.
    const el = event.button === 0 ? linkAt(event) : null
    linkPress = el ? { x: event.clientX, y: event.clientY, el } : null
    return false
  },
  mousemove(event) {
    // Dragging away (or off the link) cancels the pending open.
    if (!linkPress) return false
    const moved = Math.hypot(event.clientX - linkPress.x, event.clientY - linkPress.y)
    if (moved >= LINK_DRAG_SLOP_PX || linkAt(event) !== linkPress.el) linkPress = null
    return false
  },
  mouseup(event) {
    const el = linkAt(event)
    const open = shouldOpenOnRelease(linkPress, {
      x: event.clientX, y: event.clientY, el, button: event.button,
    })
    linkPress = null
    if (!open || !el) return false
    const href = el.getAttribute('data-cm-lp-href')
    if (!href) return false
    event.preventDefault()
    openExternal(href)
    return true
  },
})

export function linksLivePreview(deps: LinksLivePreviewDeps): Extension {
  return [linksLivePreviewField(deps), linksTheme, externalLinkClickHandler]
}
