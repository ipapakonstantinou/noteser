'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView, keymap, drawSelection, type Command } from '@codemirror/view'
import { Prec, Compartment } from '@codemirror/state'
import { moveLineUp, moveLineDown, deleteLine, history } from '@codemirror/commands'
import { toggleFold, foldAll, unfoldAll } from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { diffGutterExtension, setDiffBaseline } from './diffGutter'
import { foldableHeadings } from './foldableHeadings'
import { getLastPushedContent } from '@/utils/lastPushedContent'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { useUIStore, useGitHubStore } from '@/stores'
import { useSettingsStore } from '@/stores/settingsStore'
import { markdownLivePreview } from './markdownLivePreview'
import { tasksLivePreview } from './tasksLivePreview'
import { basesLivePreview } from './basesLivePreview'
import { imagesLivePreview } from './imagesLivePreview'
import { linksLivePreview } from './linksLivePreview'
import { hangingIndentExtension } from './hangingIndentPlugin'
import { getActiveWikilinkQuery } from '@/utils/wikilinks'
import { getActiveTagQuery } from '@/utils/tagAutocomplete'
import { collectAllTags } from '@/utils/tags'
import { findNoteByTitleOrAlias } from '@/utils/aliases'
import { toggleTaskLineText, UI_TASK_LINE_REGEX } from '@/utils/tasks'
import {
  splitListLine,
  cycleState,
  nextCycleState,
  setCycleState,
  toggleBullet,
  renumberOrderedRuns,
} from '@/utils/listTransforms'
import {
  buildEmptyRow,
  buildTable,
  findCellIndexAtPos,
  findCellRanges,
  findTableBounds,
  nextCellTarget,
  prevCellTarget,
} from '@/utils/markdownTable'
import { findFragmentLine } from '@/utils/wikilinkTarget'
import {
  appendBlockId,
  buildBlockRefLink,
  extractTrailingBlockId,
  generateBlockId,
} from '@/utils/blockRef'
import { useNoteStore } from '@/stores/noteStore'
import { saveAttachment } from '@/utils/attachments'
import { isBareUrl, anchorFromHtml, markdownLink, FETCHING_TITLE_PLACEHOLDER } from '@/utils/pasteLink'
import { WikilinkAutocomplete } from './WikilinkAutocomplete'
import { TagAutocomplete } from './TagAutocomplete'
import { getConfiguredUrl } from '@/hooks/useCollaboration'
// Type-only import: erased at compile time, so it does NOT pull yjs /
// y-websocket / y-codemirror.next into the editor bundle. The actual
// createCollabBinding implementation is loaded via dynamic import() inside
// the collab effect below — only when NEXT_PUBLIC_YJS_WS_URL is configured.
import { type CollabBinding } from './collabExtension'
import type { Note } from '@/types'

interface WikilinkState {
  query: string
  start: number
  position: { top: number; left: number }
}

interface TagState {
  query: string
  start: number // position of `#`
  position: { top: number; left: number }
}

interface CodeMirrorEditorProps {
  noteId: string
  initialContent: string
  activeNotes: Note[]
  onSave: (content: string) => void
  onWikilinkNavigate: (note: Note) => void
  viewRef?: React.MutableRefObject<EditorView | null>
}

// Save dropped/pasted images to IndexedDB and splice markdown image
// references into the document at `pos`. Async on purpose — the drop/paste
// event handler kicks this off and returns immediately so CodeMirror doesn't
// block on the IDB write.
async function insertImagesAt(view: EditorView, files: File[], pos: number): Promise<void> {
  const refs: string[] = []
  for (const file of files) {
    try {
      const path = await saveAttachment(file, file.name || 'image.png')
      const alt = (file.name || 'image').replace(/\.[^.]+$/, '')
      refs.push(`![${alt}](${path})`)
    } catch (err) {
      console.error('Failed to save dropped attachment', err)
    }
  }
  if (refs.length === 0) return
  // Join with blank lines so each image renders as its own block. Anchor the
  // caret immediately after the last reference.
  const insert = refs.join('\n\n')
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
  })
}

// Insert `[Fetching title…](url)` at `pos`, then swap the placeholder for
// the real page title once /api/link-title answers. The swap re-locates the
// exact placeholder string instead of trusting saved offsets, so concurrent
// typing elsewhere in the note can't corrupt the splice — if the user edited
// the placeholder itself, the swap silently aborts. On a failed or empty
// lookup the whole link collapses back to the bare URL (Obsidian Auto Link
// Title behavior).
async function insertLinkWithFetchedTitle(view: EditorView, url: string, pos: number): Promise<void> {
  const placeholder = markdownLink(FETCHING_TITLE_PLACEHOLDER, url)
  view.dispatch({
    changes: { from: pos, to: pos, insert: placeholder },
    selection: { anchor: pos + placeholder.length },
  })

  let title: string | null = null
  try {
    const res = await fetch(`/api/link-title?url=${encodeURIComponent(url)}`)
    if (res.ok) {
      const data = (await res.json()) as { title?: string | null }
      title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title : null
    }
  } catch {
    // Network failure — fall through to the bare-URL fallback.
  }

  const doc = view.state.doc.toString()
  const found = doc.indexOf(placeholder, Math.max(0, pos - placeholder.length))
  const at = found !== -1 ? found : doc.indexOf(placeholder)
  if (at === -1) return // user edited the placeholder away; leave their text alone

  const replacement = title ? markdownLink(title, url) : url
  view.dispatch({
    changes: { from: at, to: at + placeholder.length, insert: replacement },
  })
}

// ── List / todo line-command plumbing ──────────────────────────────────────
// Rewrite ordered-list numbers across the whole document if any are wrong.
// Emits MINIMAL per-line changes (only the lines whose number changed) rather
// than a full-doc replace, so the diff gutter and undo history stay tidy and
// the existing caret mapping survives. No-op (no transaction) when every
// number is already correct, so it is safe to call after every list edit and
// after a move-line.
function renumberDocument(view: EditorView): void {
  const { doc } = view.state
  const currentLines = doc.toString().split('\n')
  const fixedLines = renumberOrderedRuns(currentLines.join('\n')).split('\n')

  const changes: { from: number; to: number; insert: string }[] = []
  for (let i = 0; i < currentLines.length; i++) {
    if (currentLines[i] !== fixedLines[i]) {
      const line = doc.line(i + 1)
      changes.push({ from: line.from, to: line.to, insert: fixedLines[i] })
    }
  }
  if (changes.length === 0) return
  view.dispatch({ changes })
}

// Mod+L — Obsidian "Toggle checkbox status". On an existing task line we route
// through toggleTaskLineText so the ✅-date stamp + recurring-task behaviour is
// preserved; on a plain/bullet/ordered line we convert it into an unchecked
// task. Works across a multi-line selection.
export const toggleCheckboxStatus: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)

  const changes: { from: number; to: number; insert: string }[] = []
  let firstLineNewText: string | null = null
  let firstLineWasTask = false
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const line = state.doc.line(n)
    const parts = splitListLine(line.text)
    let next: string
    if (parts.kind === 'task') {
      const flipped = toggleTaskLineText(line.text)
      next = flipped ?? line.text
    } else {
      const carrier = parts.kind === 'ordered' ? parts.carrier : '- '
      next = `${parts.indent}${carrier}[ ] ${parts.body}`
    }
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
    if (n === fromLine.number) {
      firstLineNewText = next
      firstLineWasTask = parts.kind === 'task'
    }
  }
  if (changes.length === 0) return false
  // When the user converts a plain/bullet/ordered line into a NEW task with
  // an empty cursor, park the caret at the end of the rewritten line so they
  // can keep typing. Existing-task flips leave the caret alone (cursor
  // position carries useful intent for the done/undone case).
  const shouldMoveCaret =
    range.empty &&
    fromLine.number === toLine.number &&
    !firstLineWasTask &&
    firstLineNewText != null
  view.dispatch({
    changes,
    selection: shouldMoveCaret
      ? { anchor: fromLine.from + (firstLineNewText as string).length }
      : undefined,
    scrollIntoView: true,
  })
  renumberDocument(view)
  return true
}

// Mod+Alt+Shift+L — Cycle list type. Advance the selected line(s) through the
// three-state cycle: plain -> numbered ("1. ") -> task ("- [ ] ") -> plain.
// For a multi-line selection we read the FIRST line's state, advance ONCE, and
// drive EVERY line to that same target so a mixed selection ends up uniform
// (this mirrors how the other list toggles read intent off the leading line).
// Indentation/nesting is preserved by the pure helpers; ordered runs are then
// renumbered so "1." sequences read 1,2,3.
export const cycleListTypeCommand: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)

  const target = nextCycleState(cycleState(fromLine.text))

  const changes: { from: number; to: number; insert: string }[] = []
  let firstLineNewText: string | null = null
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const line = state.doc.line(n)
    const next = setCycleState(line.text, target)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
    if (n === fromLine.number) firstLineNewText = next
  }
  if (changes.length === 0) return false
  // Park the caret AFTER the new marker on the first affected line so the
  // user can keep typing without first pressing End. Without this, CodeMirror
  // anchors the cursor to the LEFT of the inserted marker, which is the
  // wrong UX for the "convert this line into a task" use case.
  const firstNewLength = firstLineNewText?.length ?? fromLine.length
  const cursorAfterMarker = fromLine.from + firstNewLength
  view.dispatch({
    changes,
    selection: range.empty && fromLine.number === toLine.number
      ? { anchor: cursorAfterMarker }
      : undefined,
    scrollIntoView: true,
  })
  renumberDocument(view)
  return true
}

// Mod+Alt+Shift+B — Toggle plain bullet list. STANDALONE toggle, separate from
// the Mod+Alt+Shift+L cycle (a bullet is NOT one of the cycle's states). On a
// plain line it prepends "- "; on an existing "- " bullet it strips the marker
// back to plain. Works across a multi-line selection and preserves each line's
// indentation. The string logic lives in toggleBullet (listTransforms.ts).
const toggleBulletCommand: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)

  const changes: { from: number; to: number; insert: string }[] = []
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const line = state.doc.line(n)
    const next = toggleBullet(line.text)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  if (changes.length === 0) return false
  view.dispatch({ changes, scrollIntoView: true })
  // Bullets carry no numbers, but a toggle can convert an ordered line into a
  // bullet (toggleBullet ordered -> bullet), so heal any ordered runs left
  // behind elsewhere in the doc — matches the other list commands.
  renumberDocument(view)
  return true
}

// Pressing Enter at the end of an EMPTY checkbox line exits the list, leaving a
// blank line (Obsidian behaviour). Returns false for everything else so the
// markdown keymap keeps handling normal continuation — a checkbox WITH text
// continues as a fresh "- [ ] ", which already works. This exists because the
// markdown continuation only recognises a task when a space follows the "]";
// a freshly-inserted "- [ ]" with the cursor right after the bracket would
// otherwise degrade into a plain "- " bullet on Enter.
const EMPTY_CHECKBOX_LINE = /^(\s*)([-*+])\s+\[[ xX]\]\s*$/
const exitEmptyCheckboxOnEnter: Command = (view) => {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to) return false
  if (!EMPTY_CHECKBOX_LINE.test(line.text)) return false
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '' },
    selection: { anchor: line.from },
    userEvent: 'input',
  })
  return true
}

// Shift+Enter inside a list/task line — insert a newline + a continuation
// indent that matches the current item's MARKER WIDTH, so the next line is
// parsed as a paragraph continuation of the same list item (CommonMark "list
// paragraph" rule). The new line has NO list marker — Enter still starts a
// fresh sibling item via the markdown extension's continuation handler.
//
// Marker widths produced (no extra leading indent):
//   "- text"        -> 2  ("- ")
//   "1. text"       -> 3  ("1. "); "12. text" -> 4
//   "- [ ] text"    -> 6  ("- " + "[ ] ")
//   "1. [ ] text"   -> 7
//   "   - nested"   -> 3 + 2 = 5 (indent preserved)
//
// On a plain line: returns false so the default Shift+Enter (= newline) runs.
// On a multi-selection: not handled (returns false) — the markdown extension's
// fallbacks then take over.
export const continueListItemParagraph: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false
  const line = state.doc.lineAt(range.from)
  const parts = splitListLine(line.text)
  if (parts.kind === 'plain') return false

  // Continuation prefix: preserve the literal indent (tabs stay tabs), then
  // pad with SPACES to cover the marker (carrier + checkbox if any). Using
  // literal indent keeps tab/space conventions consistent with the surrounding
  // doc; space-padding the marker portion is what CommonMark requires for the
  // paragraph to attach to the list item.
  const markerWidth = parts.carrier.length + (parts.kind === 'task' ? 4 : 0)
  const pad = parts.indent + ' '.repeat(markerWidth)

  const insert = '\n' + pad
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

// Wrap a built-in move-line command so an ordered list renumbers after the
// move. Obsidian renumbers when you Alt+Up/Down a list item; this matches.
function moveLineThenRenumber(base: Command): Command {
  return (view) => {
    const moved = base(view)
    if (!moved) return false
    renumberDocument(view)
    return true
  }
}

// Renumber ordered lists after a structural edit (Enter inserts a new "1."
// item, Backspace removes one, paste, etc.) so "1." sequences self-heal to
// 1,2,3 — matching Obsidian. Guarded so the renumber transaction it dispatches
// does not retrigger itself, and skipped while a CodeMirror composition (IME)
// is active. We only react when an ordered-list line is present in the new doc
// AND the change inserted or deleted a newline (the operations that shift item
// counts); pure in-line typing is left alone for performance.
const ORDERED_LINE_PROBE = /(^|\n)\s*\d+\.\s/
let renumberInFlight = false
const renumberOnEdit = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return
  if (renumberInFlight) return
  if (update.view.composing) return

  let touchedNewline = false
  let touchedOrderedLineStart = false
  update.changes.iterChanges((_fA, _tA, fB, tB, inserted) => {
    if (inserted.toString().includes('\n')) touchedNewline = true
    // Indent/dedent on an ordered-list line (Tab / Shift+Tab) changes the
    // line's effective list depth without inserting a newline, so renumber
    // must still re-run. Check whether the changed range overlaps the
    // leading whitespace of an ordered-list line in the NEW doc.
    if (!touchedOrderedLineStart) {
      const startLine = update.state.doc.lineAt(fB)
      const endLine = update.state.doc.lineAt(tB)
      for (let n = startLine.number; n <= endLine.number; n++) {
        const line = update.state.doc.line(n)
        if (/^\s*\d+\.\s/.test(line.text)) {
          touchedOrderedLineStart = true
          break
        }
      }
    }
  })
  // Deletions of a newline also matter. iterChanges' inserted is the new text;
  // detect removed newlines by comparing line counts.
  if (!touchedNewline && update.startState.doc.lines !== update.state.doc.lines) {
    touchedNewline = true
  }
  if (!touchedNewline && !touchedOrderedLineStart) return
  if (!ORDERED_LINE_PROBE.test(update.state.doc.toString())) return

  renumberInFlight = true
  // Defer to escape the current update cycle (dispatching inside an
  // updateListener is discouraged).
  queueMicrotask(() => {
    try {
      renumberDocument(update.view)
    } finally {
      renumberInFlight = false
    }
  })
})

const obsidianTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#dadada', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', height: '100%' },
  '.cm-content': {
    // Driven by --font-text (fnt1) so a chosen Text font applies to the
    // editor body live. Falls back to the historical monospace stack
    // when the variable is unset.
    fontFamily: 'var(--font-text, ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace)',
    lineHeight: '1.7',
    padding: '16px',
    caretColor: '#dadada',
    minHeight: '100%',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#dadada' },
  // Selection background. The editor renders selections with drawSelection()
  // (enabled by default in @uiw basicSetup), which paints a .cm-selectionBackground
  // layer BEHIND the text. The bug: this editor mounts with the default
  // theme="light", so CodeMirror's built-in
  // `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
  // rule (a pale lavender #d7d4f0) won on specificity over our old low-specificity
  // override — pale background + near-white text = unreadable selection.
  //
  // `&light`/`&dark` prefixes only work in EditorView.baseTheme, NOT here, so we
  // instead match CodeMirror's full child-combinator chain (`&` is this theme's
  // root class) to outrank the built-in default. We paint the selection with the
  // theme-aware `--obsidian-selection` token. That token is DISTINCT from
  // `--obsidian-highlight` (the sidebar hover surface) so a selection-visible
  // colour can't bleed into every hover state in the chrome (2026-06-05). Each
  // preset overrides it to a value that clears ≥ 2:1 against the editor bg AND
  // ≥ 4.5:1 against the editor text. The bare `.cm-selectionBackground`
  // covers the unfocused state.
  '.cm-selectionBackground': { backgroundColor: 'var(--obsidian-selection, #2b5a9b)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--obsidian-selection, #2b5a9b)',
  },
  // Selection FOREGROUND (2026-06-10). drawSelection() hides only the native
  // selection's background-color (`.cm-line ::selection { background-color:
  // transparent !important }` in @codemirror/view) — the ::selection `color`
  // still applies. Without it, accent-coloured glyphs (task `[x]` brackets,
  // list markers, #tags, links — all hsl(217,88%,50%)) sat at ~1.4:1 against
  // the blue selection layer and read as invisible ("selected text goes
  // invisible", bug #38). Recolour selected glyphs to the standard editor
  // text colour, which every preset guarantees ≥ 4.5:1 against the selection
  // (themeSelectionContrast.test.ts).
  '.cm-line::selection, .cm-line ::selection': {
    color: 'var(--obsidian-text, #dadada)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
  // No display:none on .cm-gutters — basicSetup disables line-numbers
  // and fold-gutter (see <CodeMirror basicSetup={...} />), so the only
  // gutter mounted is our diff gutter, which needs to render. The
  // default CodeMirror theme paints `.cm-gutters` with a light grey
  // background + 1px right border, which read as a visible vertical
  // seam against the dark editor (user feedback 2026-06-04). Force
  // transparent + no border so the seam between the sidebar and the
  // editor stays invisible.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
  },
  '.cm-placeholder': { color: '#6b7280' },
  // Search / replace panel — repaint it in the Obsidian palette so it
  // doesn't look like a stray native form on top of the editor.
  '.cm-panels': { backgroundColor: '#1e1e1e', color: '#dadada', borderColor: '#3a3a3a' },
  '.cm-panel.cm-search': {
    backgroundColor: '#1e1e1e',
    padding: '6px 8px',
    borderBottom: '1px solid #3a3a3a',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontSize: '12px',
  },
  '.cm-panel.cm-search input[type=text]': {
    backgroundColor: '#2a2a2a',
    color: '#dadada',
    border: '1px solid #3a3a3a',
    borderRadius: '3px',
    padding: '2px 6px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: '#2a2a2a',
    color: '#dadada',
    border: '1px solid #3a3a3a',
    borderRadius: '3px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: '#3a3a3a' },
  '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.25)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.55)' },
})

// Opt the editable surface into (or out of) the device keyboard's autocorrect,
// auto-capitalisation, and word suggestions. CodeMirror disables all three by
// default so it won't "correct" code or markdown; the "Autocorrect & word
// suggestions" setting turns them on, which is what makes a phone keyboard show
// its predictive-text strip. Returns an explicit off-state too, so the
// compartment flips deterministically rather than relying on browser defaults.
function autocorrectAttrs(enabled: boolean) {
  // `autocomplete: 'off'` is separate from the autocorrect/predict toggle:
  // it suppresses Chrome Android's password / payment / address autofill row
  // that otherwise stacks above the keyboard and hides our mobile formatting
  // toolbar. The contenteditable isn't fillable anyway, so the row is noise.
  return EditorView.contentAttributes.of(
    enabled
      ? { autocorrect: 'on', autocapitalize: 'sentences', spellcheck: 'true', autocomplete: 'off' }
      : { autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' }
  )
}

export function CodeMirrorEditor({
  noteId,
  initialContent,
  activeNotes,
  onSave,
  onWikilinkNavigate,
  viewRef,
}: CodeMirrorEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const [wikilinkState, setWikilinkState] = useState<WikilinkState | null>(null)
  const [tagState, setTagState] = useState<TagState | null>(null)

  // When collaboration is enabled the shared Y.Text is the SINGLE source of
  // truth for the document content. The collab binding (yCollab) seeds the
  // Y.Text with the note body after the first sync and replays it into the
  // editor via its observer. If the editor ALSO started life holding the same
  // body (value={initialContent}), that replayed insert lands on top of the
  // existing text and the body is DOUBLED on screen — and the doubled text is
  // what gets saved back to the note (= corruption that would sync to GitHub).
  // So when collab is on we build the editor EMPTY and let the Y.Text populate
  // it: the seeder sees its body exactly once, a joiner receives the shared
  // body over the wire exactly once. When collab is off this is a no-op and
  // the editor is byte-for-byte identical to before. getConfiguredUrl() is the
  // exact gate the collab effect below uses, so this branches together with it.
  const collabEnabled = getConfiguredUrl() != null
  const editorInitialValue = collabEnabled ? '' : initialContent

  // Live-collaboration (Phase B). A Compartment lets us swap the yCollab
  // binding in/out per note without rebuilding the whole (memoized)
  // extension list. The compartment is created ONCE and stays empty unless
  // collaboration is enabled — when getConfiguredUrl() is null the effect
  // below never runs and the compartment never holds anything, so the
  // editor is byte-for-byte the same as before this phase.
  const collabCompartmentRef = useRef(new Compartment())
  const collabBindingRef = useRef<CollabBinding | null>(null)

  // Autocorrect / word-suggestions compartment. Created once; reconfigured by
  // an effect when the `editorAutocorrect` setting flips, so we toggle it live
  // without rebuilding the (memoized-once) extension list.
  const autocorrectCompartmentRef = useRef(new Compartment())
  const editorAutocorrect = useSettingsStore(s => s.editorAutocorrect)

  // History lives in its own compartment so the undo stack can be CLEARED on
  // note change. The editor view is no longer torn down per note (we dropped
  // the `key={noteId}` remount for speed), so a shared history would let
  // Ctrl+Z undo across note boundaries — and worse, undo the doc-swap and
  // replay the previous note's text into the current note. Reconfiguring the
  // compartment re-creates the history field, which empties it. basicSetup's
  // built-in history is disabled below so this is the only history extension.
  const historyCompartmentRef = useRef(new Compartment())

  // Stable refs so extension callbacks always see the latest values
  const activeNotesRef = useRef(activeNotes)
  const navigateRef = useRef(onWikilinkNavigate)
  const noteIdRef = useRef(noteId)
  useEffect(() => { activeNotesRef.current = activeNotes }, [activeNotes])
  useEffect(() => { navigateRef.current = onWikilinkNavigate }, [onWikilinkNavigate])
  useEffect(() => { noteIdRef.current = noteId }, [noteId])
  // Switching active note dismisses any open autocomplete dropdowns. Without
  // this, the popup floats over the new note's editor (visible bug 2026-06-08).
  useEffect(() => {
    setTagState(null)
    setWikilinkState(null)
  }, [noteId])

  // Per-note reset for the reused editor view (no more keyed remount).
  // react-codemirror swaps the doc in place when `value` changes, but two
  // bits of view state would otherwise bleed across notes: the undo history
  // and the scroll / cursor position. Clear both on note change. This runs
  // AFTER react-codemirror's own value-sync effect — child effects (the inner
  // <CodeMirror>) flush before this parent component's — so reconfiguring the
  // history field here also drops the doc-swap transaction from the undo
  // stack. The reconfigure + selection change touch no doc text, so they fire
  // no onChange (its updateListener is docChanged-gated) and trigger no save.
  useEffect(() => {
    const view = cmRef.current?.view
    if (!view) return
    // Clear the undo stack by toggling the history extension OFF then ON.
    // history() shares a module-level StateField, so reconfiguring straight
    // to a fresh history() PRESERVES the existing field (undo would still
    // cross notes — caught by e2e/editor-reuse). Removing the extension drops
    // the field entirely; re-adding it recreates an empty one.
    const hist = historyCompartmentRef.current
    view.dispatch({ effects: hist.reconfigure([]) })
    view.dispatch({
      selection: { anchor: 0 },
      effects: hist.reconfigure(history()),
    })
    // A reused view keeps the previous note's scroll offset — jump to the top.
    // scrollDOM is absent in the jsdom test view, so guard the assignment.
    if (view.scrollDOM) view.scrollDOM.scrollTop = 0
  }, [noteId])

  // Diff-gutter baseline (109): when the note changes — or after a
  // successful sync writes a fresh snapshot — fetch the last-pushed
  // content from IDB and dispatch it into the editor so the gutter
  // knows what to diff against. No snapshot yet (note never pushed)
  // → empty string, which computeDiffMarkers treats as "clean".
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const baseline = (await getLastPushedContent(noteId)) ?? ''
      if (cancelled) return
      const view = cmRef.current?.view
      if (!view) return
      view.dispatch({ effects: setDiffBaseline.of(baseline) })
    })()
    return () => { cancelled = true }
  }, [noteId, lastSyncedAt])

  // ── Live collaboration (Phase B) ────────────────────────────────────
  // Bind a shared Y.Doc to the editor when collab is enabled. DORMANT by
  // default: getConfiguredUrl() returns null unless NEXT_PUBLIC_YJS_WS_URL
  // is a valid ws/wss URL, in which case this effect returns immediately —
  // no Y.Doc, no WebSocket, no awareness, compartment stays empty.
  //
  // Keyed on noteId so the provider+doc tear down and re-create on note
  // change. The room name is the note's STABLE collabId (lazily minted via
  // the store) so a shared room survives renames / folder moves. Remote
  // edits arrive as CodeMirror transactions → the existing onChange path
  // persists them to the note store, and the diff-gutter baseline effect is
  // independent so the gutter keeps working.
  const githubUser = useGitHubStore(s => s.user)
  const githubUserRef = useRef(githubUser)
  useEffect(() => { githubUserRef.current = githubUser }, [githubUser])
  useEffect(() => {
    const url = getConfiguredUrl()
    if (!url) return // dormant: identical to pre-Phase-B behaviour

    // Mint (or reuse) the stable room id for this note.
    const room = useNoteStore.getState().ensureCollabId(noteId)
    if (!room) return

    // Capture the stable compartment locally so the cleanup closure doesn't
    // reach back through the ref (and so eslint is happy). The view, by
    // contrast, must be read FRESH at teardown — it can be recreated by the
    // keyed remount, so we read cmRef.current?.view inside the callbacks.
    const compartment = collabCompartmentRef.current
    let binding: CollabBinding | null = null
    let cancelled = false

    // The CodeMirror view is created during the keyed remount; it may not
    // exist on the very first effect tick. Poll a couple of microtasks for
    // it, then bail if it never shows (note closed mid-mount).
    //
    // createCollabBinding (and its yjs / y-websocket / y-codemirror.next
    // dependencies, ~hundreds of kB) is loaded lazily here so it never lands
    // in the default editor bundle. We only reach this code when a collab URL
    // is configured, which is opt-in via NEXT_PUBLIC_YJS_WS_URL.
    const attach = async (attemptsLeft: number) => {
      if (cancelled) return
      const view = cmRef.current?.view
      if (!view) {
        if (attemptsLeft <= 0) return
        queueMicrotask(() => { void attach(attemptsLeft - 1) })
        return
      }
      const { createCollabBinding } = await import('./collabExtension')
      // The component may have unmounted (or the note changed) while the
      // dynamic import was in flight — re-check before touching the view.
      if (cancelled) return
      const freshView = cmRef.current?.view
      if (!freshView) return
      const note = useNoteStore.getState().notes.find(n => n.id === noteId)
      binding = createCollabBinding({
        url,
        room,
        initialContent: note?.content ?? '',
        user: githubUserRef.current,
      })
      collabBindingRef.current = binding
      freshView.dispatch({ effects: compartment.reconfigure(binding.extension) })
    }
    void attach(5)

    return () => {
      cancelled = true
      // Empty the compartment first (so the editor drops the binding's
      // plugins) then destroy the provider + doc to release the socket.
      // Reading cmRef.current FRESH at teardown is intentional: we want the
      // currently-mounted view, which the keyed remount may have replaced.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const view = cmRef.current?.view
      if (view) {
        try {
          view.dispatch({ effects: compartment.reconfigure([]) })
        } catch { /* view may already be torn down */ }
      }
      binding?.destroy()
      if (collabBindingRef.current === binding) collabBindingRef.current = null
    }
    // githubUser is intentionally read via ref (not a dep) so a login change
    // mid-session doesn't tear down the live document; the cursor label
    // updates on the next note open. Re-key only on noteId.
  }, [noteId])

  // Listen for "scroll to fragment" requests fired by the wikilink click
  // handler. The fragment is either a heading text or a `^block-id`; we
  // resolve to a line number via findFragmentLine and dispatch a CodeMirror
  // selection change so the editor scrolls + highlights the row.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ noteId: string; fragment: string }>).detail
      if (!detail || detail.noteId !== noteIdRef.current) return
      const view = cmRef.current?.view
      if (!view) return
      const content = view.state.doc.toString()
      const lineIdx = findFragmentLine(content, detail.fragment)
      if (lineIdx == null) return
      const line = view.state.doc.line(lineIdx + 1)
      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        scrollIntoView: true,
      })
      view.focus()
    }
    window.addEventListener('noteser:scroll-to-fragment', handler)
    return () => window.removeEventListener('noteser:scroll-to-fragment', handler)
  }, [])

  // Listen for the "Copy block ref" command. Only the FOCUSED editor
  // responds, so when there are two panes open the right one wins.
  useEffect(() => {
    const handler = () => {
      const view = cmRef.current?.view
      if (!view || !view.hasFocus) return
      const { head } = view.state.selection.main
      const line = view.state.doc.lineAt(head)
      // Skip empty lines — there's no anchor target to link to.
      if (line.text.trim() === '') return

      let id = extractTrailingBlockId(line.text)
      if (!id) {
        id = generateBlockId()
        const newLine = appendBlockId(line.text, id)
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newLine },
        })
      }

      const note = useNoteStore.getState().notes.find(n => n.id === noteIdRef.current)
      const title = note?.title || 'Untitled'
      const link = buildBlockRefLink(title, id)
      // Best-effort clipboard write. Browsers without clipboard API fall
      // back to a prompt — same pattern the bug-reporter uses.
      const writeClip = async () => {
        try {
          await navigator.clipboard.writeText(link)
        } catch {
          window.prompt('Copy this block link:', link)
        }
      }
      void writeClip()
    }
    window.addEventListener('noteser:copy-block-ref', handler)
    return () => window.removeEventListener('noteser:copy-block-ref', handler)
  }, [])

  const debouncedSave = useDebouncedCallback(onSave, 300)

  // Flip autocorrect / suggestions live when the setting changes. The view may
  // not exist yet on the first tick (keyed remount); the seed value in the
  // extensions memo covers the initial render, so we just no-op until it's up.
  useEffect(() => {
    const view = cmRef.current?.view
    if (!view) return
    view.dispatch({
      effects: autocorrectCompartmentRef.current.reconfigure(autocorrectAttrs(editorAutocorrect)),
    })
  }, [editorAutocorrect])

  // Extensions are stable (created once) — callbacks reach out to refs for fresh values
  const extensions = useMemo(() => [
    // Collaboration compartment. Starts empty; the collab effect
    // reconfigures it with the yCollab binding when collab is enabled.
    // Empty = zero behavioural change, which is the dormant default.
    collabCompartmentRef.current.of([]),
    // Seed with the current setting; the effect below keeps it in sync. Read
    // via getState() so this memo (empty deps) stays created-once.
    autocorrectCompartmentRef.current.of(
      autocorrectAttrs(useSettingsStore.getState().editorAutocorrect),
    ),
    // Undo history in a compartment so the per-note reset effect can clear it.
    // basicSetup's own history() is disabled (history: false) so this is the
    // single source of undo state; historyKeymap (still on) drives it.
    historyCompartmentRef.current.of(history()),
    markdown({ base: markdownLanguage }),
    markdownLivePreview,
    tasksLivePreview,
    basesLivePreview,
    imagesLivePreview,
    // Clickable links in live preview (bare URLs, [text](url), [[wikilinks]]).
    // Accessors read the stable refs so the (memoized-once) extension always
    // resolves against the current note set + navigate callback — same idiom
    // the Ctrl+Click wikilink handler below uses.
    linksLivePreview({
      getActiveNotes: () => activeNotesRef.current,
      onWikilinkNavigate: (note) => navigateRef.current(note),
    }),
    diffGutterExtension,
    // Collapsible heading sections (Obsidian parity). Adds a fold gutter with
    // a chevron next to every ATX heading; clicking collapses everything under
    // it until the next heading of the same-or-higher level. View-only — the
    // markdown text is untouched, so collab + live-preview decorations + save
    // all keep working. See foldableHeadings.ts for the range logic. Keyboard
    // toggles (Mod-., Mod-Alt-[ / Mod-Alt-]) are wired in the keymap below.
    foldableHeadings,
    // Built-in find / replace panel. `top: true` opens it above the
    // editor — matches VS Code / Obsidian placement. Keymap includes
    // Ctrl+F (find), Ctrl+H (replace), F3/Shift+F3 (next/prev), Esc
    // (close). High precedence so noteser's own keymap doesn't shadow.
    search({ top: true }),
    Prec.highest(keymap.of([
      // Drop the search keymap's Mod-d (= selectNextOccurrence). Obsidian
      // leaves Cmd/Ctrl+D unbound, and Jon found noteser's Mod+D surprising
      // (selecting/replacing the word read as a "delete the line"). Removing
      // it restores Obsidian parity — Mod+D now does nothing in the editor.
      ...searchKeymap.filter(b => b.key !== 'Mod-d'),
      // Obsidian binds Ctrl+H to find-and-replace. The CodeMirror panel
      // shows both find + replace inputs, so this just opens the same
      // panel as Ctrl+F.
      { key: 'Ctrl-h', preventDefault: true, run: openSearchPanel },
    ])),
    obsidianTheme,
    EditorView.lineWrapping,
    // Hanging indent for soft-wrapped list lines: wrapped continuation rows
    // align with the START of the BODY (after the marker) instead of column 0,
    // matching Obsidian Live Preview. Visual only — never modifies markdown.
    hangingIndentExtension,
    // Explicit drawSelection() so the .cm-selectionBackground layer is
    // guaranteed to render regardless of basicSetup defaults. We already paint
    // that layer with var(--obsidian-selection) (see obsidianTheme above), and
    // globals.css carries a `::selection` fallback for the native path —
    // belt-and-suspenders so a future @uiw basicSetup change that drops
    // drawSelection() from defaults can't leave the selection invisible again.
    drawSelection(),
    renumberOnEdit,
    // Prec.highest ensures our bindings win over any conflicting default keymap.
    Prec.highest(keymap.of([
    {
      key: 'Ctrl-e',
      preventDefault: true,
      run() {
        useUIStore.getState().togglePreview()
        return true
      },
    },
    // Mod+D — delete the current line. preventDefault suppresses the browser's
    // "bookmark this page" dialog (Ctrl+D), which is interceptable (unlike
    // Ctrl+W). Replaces the old selectNextOccurrence binding we removed.
    { key: 'Mod-d', preventDefault: true, run: deleteLine },
    // ── Heading folding (Obsidian parity) ──────────────────────────────────
    // Mod+. toggles the fold on the heading section at the cursor. Mod+Alt+[
    // / Mod+Alt+] fold / unfold every section (CodeMirror's default fold-all
    // chords; the app's own foldKeymap is disabled in basicSetup so these
    // don't double-fire). None of these collide with the editor's existing
    // bindings or the app-level shortcuts (Ctrl+. and the Alt-bracket chords
    // are unused — see src/utils/shortcuts.ts).
    { key: 'Mod-.', preventDefault: true, run: toggleFold },
    { key: 'Mod-Alt-[', preventDefault: true, run: foldAll },
    { key: 'Mod-Alt-]', preventDefault: true, run: unfoldAll },
    // Enter on an EMPTY checkbox exits the list. No preventDefault: when it
    // returns false (any other line) the event falls through to the markdown
    // keymap's normal Enter continuation.
    { key: 'Enter', run: exitEmptyCheckboxOnEnter },
    // Shift+Enter inside a list/task line: insert a continuation indent so the
    // next line parses as a paragraph inside the same list item (instead of a
    // top-level paragraph at column 0). Returns false on plain lines so the
    // browser's default Shift+Enter (= plain newline) still runs there.
    { key: 'Shift-Enter', run: continueListItemParagraph },
    // ── Obsidian-style list / todo commands ────────────────────────────────
    // (1) Mod+L — Toggle checkbox status (Obsidian default). Flip a task
    // done/undone; turn a plain/bullet/numbered line into a checkbox.
    { key: 'Mod-l', preventDefault: true, run: toggleCheckboxStatus },
    // (2) Mod+Alt+Shift+L — Cycle list type. One key that advances the current
    // line(s) through plain -> numbered ("1. ") -> task ("- [ ] ") -> plain.
    // Replaces the earlier trio of Mod+Shift+7/8/9 toggles. Separate from
    // Mod+L (which only toggles a checkbox done/undone).
    {
      key: 'Mod-Alt-Shift-l',
      preventDefault: true,
      run: cycleListTypeCommand,
    },
    // (3) Mod+Alt+Shift+B — Toggle a plain bullet list ("- ") on the current
    // line(s). A STANDALONE toggle, NOT part of the Mod+Alt+Shift+L cycle:
    // a plain line gains "- ", a "- " bullet drops it. Multi-line aware,
    // indentation preserved.
    {
      key: 'Mod-Alt-Shift-b',
      preventDefault: true,
      run: toggleBulletCommand,
    },
    // (5) Alt+Up / Alt+Down — Move line up/down (Obsidian default), then
    // renumber ordered runs so "1." sequences stay 1,2,3 after the move.
    { key: 'Alt-ArrowUp', preventDefault: true, run: moveLineThenRenumber(moveLineUp) },
    { key: 'Alt-ArrowDown', preventDefault: true, run: moveLineThenRenumber(moveLineDown) },
    {
      // Open the "Create or edit Task" modal for the task line under the
      // cursor. Mirrors Obsidian Tasks' Mod+Shift+T binding. No-op for lines
      // that aren't task lines — falls through so the chord still works in
      // future for non-task contexts (e.g. turn-into-task) without us having
      // to claim the key globally.
      key: 'Mod-Shift-t',
      preventDefault: true,
      run(view) {
        const { head } = view.state.selection.main
        const line = view.state.doc.lineAt(head)
        if (!UI_TASK_LINE_REGEX.test(line.text)) return false
        useUIStore.getState().openModal({
          type: 'task-edit',
          data: { noteId: noteIdRef.current, line: line.number - 1 },
        })
        return true
      },
    },
    {
      // Insert a 2-row × 2-col markdown table at the cursor. Drops the
      // template on its own block (precedes with a blank line if the
      // current line isn't empty) and selects "Header 1" so the user
      // can type to overwrite.
      key: 'Mod-Alt-t',
      preventDefault: true,
      run(view) {
        const { head } = view.state.selection.main
        const line = view.state.doc.lineAt(head)
        const prefix = line.text === '' ? '' : '\n\n'
        const t = buildTable(2, 2)
        const insertPos = prefix === '' ? line.from : line.to
        const insertText = `${prefix}${t.text}`
        const baseOffset = insertPos + prefix.length
        view.dispatch({
          changes: { from: insertPos, to: insertPos, insert: insertText },
          selection: {
            anchor: baseOffset + t.selectionFrom,
            head: baseOffset + t.selectionTo,
          },
        })
        return true
      },
    },
    {
      // Tab inside a markdown table jumps to the next cell. Past the
      // last cell of the last body row a fresh row is appended. Returns
      // false (so the default Tab indentation runs) when the cursor is
      // not inside a table.
      key: 'Tab',
      preventDefault: false,
      run(view) {
        const { state } = view
        const { head } = state.selection.main
        const docLine = state.doc.lineAt(head)
        const lineIdx = docLine.number - 1
        const col = head - docLine.from
        const lines = state.doc.toString().split('\n')

        const bounds = findTableBounds(lines, lineIdx)
        if (!bounds) return false

        const cellIdx = findCellIndexAtPos(docLine.text, col)
        // Cursor on the divider row → drop into the first body cell.
        if (cellIdx == null && lineIdx !== bounds.dividerIdx) return false

        // Effective starting position when on the divider: treat it as
        // the last cell of the divider row so nextCellTarget wraps to
        // the first body row.
        let fromCellIdx = cellIdx ?? 0
        let fromLineIdx = lineIdx
        if (lineIdx === bounds.dividerIdx) {
          const divCells = findCellRanges(docLine.text).length
          fromCellIdx = Math.max(0, divCells - 1)
          fromLineIdx = bounds.dividerIdx
        }

        const target = nextCellTarget(lines, fromLineIdx, fromCellIdx, bounds)
        if (!target) return false

        if (target.appendRow) {
          // Column count for the new row: take it from the divider
          // (canonical for the table). Numbering: if every existing
          // body cell follows the `Cell N` pattern with a contiguous
          // sequence, continue it; otherwise insert an empty row.
          const cols = findCellRanges(lines[bounds.dividerIdx]).length
          const cellPattern = /^Cell (\d+)$/
          let maxN = 0
          let allMatch = true
          for (let r = bounds.bodyStartIdx; r <= bounds.bodyEndIdx; r++) {
            const ranges = findCellRanges(lines[r])
            for (const range of ranges) {
              const txt = lines[r].slice(range.contentStart, range.contentEnd)
              const m = txt.match(cellPattern)
              if (!m) { allMatch = false; break }
              const n = parseInt(m[1], 10)
              if (n > maxN) maxN = n
            }
            if (!allMatch) break
          }
          const hasBody = bounds.bodyEndIdx >= bounds.bodyStartIdx
          const newRow = buildEmptyRow(
            cols,
            allMatch && hasBody ? maxN + 1 : undefined,
          )
          // Append after the last body row (or after the divider when
          // body is empty). bodyEndIdx is already the right anchor in
          // both cases.
          const anchorLine = state.doc.line(bounds.bodyEndIdx + 1)
          const insertAt = anchorLine.to
          const insertText = `\n${newRow}`
          // Compute caret position: start of content of cell 0 in the
          // new row. The new row starts at insertAt + 1 (the newline).
          const newRowStart = insertAt + 1
          const newRanges = findCellRanges(newRow)
          const contentStart = newRowStart + (newRanges[0]?.contentStart ?? 2)
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: insertText },
            selection: { anchor: contentStart },
            scrollIntoView: true,
          })
          return true
        }

        const targetLineDoc = state.doc.line(target.lineIdx + 1)
        const targetLineText = targetLineDoc.text
        const ranges = findCellRanges(targetLineText)
        const range = ranges[Math.min(target.cellIdx, ranges.length - 1)]
        if (!range) return false
        const anchor = targetLineDoc.from + range.contentStart
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
        })
        return true
      },
      shift(view) {
        const { state } = view
        const { head } = state.selection.main
        const docLine = state.doc.lineAt(head)
        const lineIdx = docLine.number - 1
        const col = head - docLine.from
        const lines = state.doc.toString().split('\n')

        const bounds = findTableBounds(lines, lineIdx)
        if (!bounds) return false

        const cellIdx = findCellIndexAtPos(docLine.text, col)
        if (cellIdx == null && lineIdx !== bounds.dividerIdx) return false

        // Cursor on the divider → treat as first cell so prev wraps to
        // the last cell of the header row.
        let fromCellIdx = cellIdx ?? 0
        let fromLineIdx = lineIdx
        if (lineIdx === bounds.dividerIdx) {
          fromCellIdx = 0
          fromLineIdx = bounds.dividerIdx
        }

        const target = prevCellTarget(lines, fromLineIdx, fromCellIdx, bounds)
        if (!target) return false

        const targetLineDoc = state.doc.line(target.lineIdx + 1)
        const targetLineText = targetLineDoc.text
        const ranges = findCellRanges(targetLineText)
        const range = ranges[Math.min(target.cellIdx, ranges.length - 1)]
        if (!range) return false
        const anchor = targetLineDoc.from + range.contentStart
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
        })
        return true
      },
    },
    ])),
    EditorView.domEventHandlers({
      dragover(event) {
        // Allow drop only when files are being dragged. Without preventDefault
        // on dragover, the browser refuses the subsequent drop event.
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault()
        }
        return false
      },
      drop(event, view) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        const images = files.filter(f => f.type.startsWith('image/'))
        if (images.length === 0) return false
        event.preventDefault()
        const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          ?? view.state.selection.main.head
        insertImagesAt(view, images, dropPos)
        return true
      },
      paste(event, view) {
        const files = Array.from(event.clipboardData?.files ?? [])
        const images = files.filter(f => f.type.startsWith('image/'))
        const text = event.clipboardData?.getData('text/plain') ?? ''

        // ── Image paste ──────────────────────────────────────────────────
        // Skip if no images, or if there's text alongside (rich paste — let
        // CodeMirror handle that path so user keeps the text).
        if (images.length > 0) {
          if (text !== '') return false
          event.preventDefault()
          const head = view.state.selection.main.head
          insertImagesAt(view, images, head)
          return true
        }

        // ── URL paste → titled markdown link ─────────────────────────────
        if (!isBareUrl(text)) return false
        const url = text.trim()
        const sel = view.state.selection.main

        // URL over a selection: the selected text IS the title.
        if (!sel.empty) {
          const selected = view.state.sliceDoc(sel.from, sel.to)
          // Selecting an existing URL and pasting another over it is a
          // replace, not a link-wrap — fall through to default paste.
          if (isBareUrl(selected)) return false
          event.preventDefault()
          const link = markdownLink(selected, url)
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: link },
            selection: { anchor: sel.from + link.length },
          })
          return true
        }

        // Clipboard carried an HTML anchor (copying a link element does
        // this): use its text as the title, no network round-trip.
        const anchor = anchorFromHtml(event.clipboardData?.getData('text/html') ?? '')
        if (anchor && anchor.text !== url) {
          event.preventDefault()
          const link = markdownLink(anchor.text, url)
          view.dispatch({
            changes: { from: sel.head, to: sel.head, insert: link },
            selection: { anchor: sel.head + link.length },
          })
          return true
        }

        // Bare URL: insert a placeholder and fetch the page title async.
        event.preventDefault()
        void insertLinkWithFetchedTitle(view, url, sel.head)
        return true
      },
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false

        // ── Checkbox toggle ──────────────────────────────────────────────────
        const line = view.state.doc.lineAt(pos)
        const cbMatch = line.text.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/)
        if (cbMatch) {
          const cbStart = line.from + cbMatch[1].length // index of '['
          const cbEnd   = cbStart + 3                   // index after ']'
          // Only toggle if the click landed on or near the [ ] glyph. We
          // route through toggleTaskLineText (rather than a single-char
          // swap) so recurring tasks get the ✅-stamp + new-instance
          // behavior on click.
          if (pos >= cbStart && pos <= cbEnd) {
            const newLine = toggleTaskLineText(line.text)
            if (newLine != null && newLine !== line.text) {
              view.dispatch({
                changes: { from: line.from, to: line.to, insert: newLine },
              })
              event.preventDefault()
              return true
            }
          }
        }

        // ── Ctrl/Cmd+Click wikilink navigation ───────────────────────────────
        if (event.ctrlKey || event.metaKey) {
          const content = view.state.doc.toString()
          const before = content.slice(0, pos)
          const after  = content.slice(pos)
          const openIdx  = before.lastIndexOf('[[')
          const closeIdx = after.indexOf(']]')
          if (openIdx !== -1 && closeIdx !== -1) {
            const rawTitle = content.slice(openIdx + 2, pos + closeIdx)
            if (!rawTitle.includes('\n') && !rawTitle.includes('[[')) {
              // Strip display-text portion + extract optional #fragment.
              const target = rawTitle.split('|')[0].trim()
              const hash = target.indexOf('#')
              const title = hash === -1 ? target : target.slice(0, hash).trim()
              const fragment = hash === -1 ? null : target.slice(hash + 1).trim() || null
              const note = findNoteByTitleOrAlias(activeNotesRef.current, title)
              if (note) {
                event.preventDefault()
                navigateRef.current(note)
                if (fragment) {
                  // Defer until the new note's editor mounts.
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('noteser:scroll-to-fragment', {
                      detail: { noteId: note.id, fragment },
                    }))
                  }, 0)
                }
                return true
              }
            }
          }
        }

        return false
      },
    }),
  ], [])

  const updateWikilinkState = useCallback((content: string) => {
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    const active = getActiveWikilinkQuery(content, cursorPos)
    if (!active) { setWikilinkState(null); return }
    const coords = view.coordsAtPos(cursorPos)
    if (!coords) return
    setWikilinkState({
      query: active.query,
      start: active.start,
      position: { top: coords.bottom + 4, left: coords.left },
    })
  }, [])

  const updateTagState = useCallback((content: string) => {
    const view = cmRef.current?.view
    if (!view) return
    // Tags and wikilinks are mutually exclusive: if we just opened the
    // wikilink popup, don't also fire the tag popup. (e.g. `[[#`)
    if (wikilinkState) { setTagState(null); return }
    const cursorPos = view.state.selection.main.head
    const active = getActiveTagQuery(content, cursorPos)
    if (!active) { setTagState(null); return }
    const coords = view.coordsAtPos(cursorPos)
    if (!coords) return
    setTagState({
      query: active.query,
      start: active.start,
      position: { top: coords.bottom + 4, left: coords.left },
    })
  }, [wikilinkState])

  const handleChange = useCallback((value: string) => {
    debouncedSave(value)
    updateWikilinkState(value)
    updateTagState(value)
  }, [debouncedSave, updateWikilinkState, updateTagState])

  const handleWikilinkSelect = useCallback((note: Note) => {
    if (!wikilinkState) return
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    const insertion = `[[${note.title}]]`
    view.dispatch({
      changes: { from: wikilinkState.start, to: cursorPos, insert: insertion },
      selection: { anchor: wikilinkState.start + insertion.length },
    })
    setWikilinkState(null)
    view.focus()
    navigateRef.current(note)
  }, [wikilinkState])

  const handleTagSelect = useCallback((tagName: string) => {
    if (!tagState) return
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    // Replace from the `#` through the cursor with `#<tag> ` (trailing
    // space so the user can continue typing immediately).
    const insertion = `#${tagName} `
    view.dispatch({
      changes: { from: tagState.start, to: cursorPos, insert: insertion },
      selection: { anchor: tagState.start + insertion.length },
    })
    setTagState(null)
    view.focus()
  }, [tagState])

  // Snapshot of all known tags across the vault. Recomputed once when
  // the editor mounts (or note switches) — collectAllTags is WeakMap-
  // cached internally, so the cost stays low at 5k+ notes.
  const allTags = useMemo(
    () => collectAllTags(useNoteStore.getState().notes),
    // `tagState` triggers a re-read so newly-typed tags become available
    // for the *next* completion. Cheap because of the per-note cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagState?.start, noteId],
  )

  return (
    <div className="flex-1 overflow-hidden h-full relative bg-obsidianBlack">
      <CodeMirror
        ref={cmRef}
        value={editorInitialValue}
        extensions={extensions}
        onChange={handleChange}
        onCreateEditor={(view) => {
          if (viewRef) viewRef.current = view
        }}
        placeholder="Start writing…  Markdown and [[wikilinks]] supported"
        height="100%"
        className="h-full"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          // History is provided via historyCompartmentRef so the per-note
          // reset effect can clear the undo stack on note change. Disabling it
          // here avoids a duplicate (uncleared) history field. historyKeymap
          // stays enabled below and drives this compartment's history.
          history: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          // CodeMirror's defaultHighlightStyle underlines headings — our
          // markdownLivePreview already provides bold + larger font for
          // headings, italics for emphasis, etc. Disable the default so the
          // heading underline (and other duplicate styling) doesn't fight us.
          syntaxHighlighting: false,
          closeBracketsKeymap: false,
          defaultKeymap: true,
          searchKeymap: false,
          historyKeymap: true,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
        }}
      />
      {wikilinkState && (
        <WikilinkAutocomplete
          query={wikilinkState.query}
          notes={activeNotes}
          position={wikilinkState.position}
          onSelect={handleWikilinkSelect}
          onClose={() => setWikilinkState(null)}
        />
      )}
      {tagState && (
        <TagAutocomplete
          query={tagState.query}
          tags={allTags}
          position={tagState.position}
          onSelect={handleTagSelect}
          onClose={() => setTagState(null)}
        />
      )}
    </div>
  )
}
