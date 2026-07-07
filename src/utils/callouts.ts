/**
 * GitHub-style alert/callout blockquotes: `> [!NOTE]`, `> [!TIP]`,
 * `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.
 *
 * The marker must be the entire first line of the blockquote's first
 * paragraph (GitHub's spec) — this module owns detecting that marker and
 * mutating the mdast tree (stripping the marker line, tagging the
 * blockquote node) so react-markdown renders a styled box instead of a
 * plain blockquote. Rendering (icon + colors) lives in CalloutBox.tsx;
 * live-preview decoration lives in markdownLivePreview.ts. Both import the
 * shared type/regex/icon-geometry from here so the three surfaces can't
 * drift out of sync.
 *
 * Deliberately out of scope: the `+`/`-` collapsible suffix some tools
 * (e.g. Obsidian's Admonition plugin) support. GitHub's own renderer does
 * not support it either, so there is no "render parity with github.com"
 * target to hit, and a collapsed state would differ between the live
 * CodeMirror editor and the static preview — the opposite of this
 * feature's goal.
 */

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export const CALLOUT_TYPES: CalloutType[] = ['note', 'tip', 'important', 'warning', 'caution']

export const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

// Case-insensitive per GitHub's spec; the marker must occupy the whole line.
const CALLOUT_MARKER_RE = /^\[!(note|tip|important|warning|caution)\]\s*$/i

/** Match a single line against the `[!TYPE]` marker; returns the lower-cased type or null. */
export function matchCalloutType(line: string): CalloutType | null {
  const m = CALLOUT_MARKER_RE.exec(line.trim())
  return m ? (m[1].toLowerCase() as CalloutType) : null
}

// Minimal mdast shapes we touch — avoids pulling in the full `mdast` types
// just for two node kinds, and keeps applyCalloutToBlockquote unit-testable
// without a real remark parse (see src/__tests__/callouts.test.ts).
export interface MdastTextNode {
  type: 'text'
  value: string
}
export interface MdastParagraphNode {
  type: 'paragraph'
  children: Array<MdastTextNode | Record<string, unknown>>
}
export interface MdastBlockquoteNode {
  type: 'blockquote'
  children: Array<MdastParagraphNode | Record<string, unknown>>
  data?: Record<string, unknown>
}

/**
 * If `node`'s first paragraph opens with a `[!TYPE]` marker on its own
 * line, strip that line from the paragraph and tag the blockquote with the
 * callout type (`node.data.hProperties`, read straight through to the
 * rendered `<blockquote>` by remark-rehype/react-markdown). Mutates `node`
 * in place. Returns the detected type, or null if this is an ordinary
 * blockquote (left untouched).
 */
export function applyCalloutToBlockquote(node: MdastBlockquoteNode): CalloutType | null {
  const first = node.children[0]
  if (!first || first.type !== 'paragraph') return null
  const para = first as MdastParagraphNode
  const firstChild = para.children[0]
  if (!firstChild || firstChild.type !== 'text') return null
  const textNode = firstChild as MdastTextNode
  const newlineIdx = textNode.value.indexOf('\n')
  const firstLine = newlineIdx === -1 ? textNode.value : textNode.value.slice(0, newlineIdx)
  const type = matchCalloutType(firstLine)
  if (!type) return null

  textNode.value = newlineIdx === -1 ? '' : textNode.value.slice(newlineIdx + 1)
  if (textNode.value === '') para.children.shift()

  node.data = {
    ...node.data,
    hName: 'blockquote',
    hProperties: {
      ...(node.data?.hProperties as Record<string, unknown> | undefined),
      className: ['callout', `callout-${type}`],
      'data-callout': type,
    },
  }
  return type
}

// ── Icon geometry ────────────────────────────────────────────────────────
// One shape list per type, shared by the React icon (CalloutBox.tsx, plain
// JSX elements) and the CodeMirror widget (markdownLivePreview.ts, raw
// createElementNS DOM nodes) — attribute keys are the literal SVG attribute
// names (kebab-case where applicable) so both consumers can apply them
// as-is without a camelCase translation layer.
export interface CalloutIconShape {
  tag: 'circle' | 'rect' | 'line' | 'polygon'
  attrs: Record<string, string | number>
}

export const CALLOUT_ICON_SHAPES: Record<CalloutType, CalloutIconShape[]> = {
  note: [
    { tag: 'circle', attrs: { cx: 8, cy: 8, r: 6.3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 } },
    { tag: 'line', attrs: { x1: 8, y1: 7, x2: 8, y2: 11, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' } },
    { tag: 'circle', attrs: { cx: 8, cy: 4.6, r: 0.9, fill: 'currentColor' } },
  ],
  tip: [
    { tag: 'circle', attrs: { cx: 8, cy: 6.3, r: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 } },
    { tag: 'rect', attrs: { x: 6, y: 10, width: 4, height: 1.6, rx: 0.4, fill: 'currentColor' } },
    { tag: 'line', attrs: { x1: 6.7, y1: 13, x2: 9.3, y2: 13, stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' } },
  ],
  important: [
    { tag: 'rect', attrs: { x: 1.5, y: 2, width: 13, height: 7.5, rx: 1.8, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 } },
    { tag: 'polygon', attrs: { points: '5,9.5 5,13 8.5,9.5', fill: 'currentColor' } },
    { tag: 'line', attrs: { x1: 8, y1: 4.2, x2: 8, y2: 6.4, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' } },
    { tag: 'circle', attrs: { cx: 8, cy: 7.6, r: 0.8, fill: 'currentColor' } },
  ],
  warning: [
    { tag: 'polygon', attrs: { points: '8,1.6 15,14.4 1,14.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } },
    { tag: 'line', attrs: { x1: 8, y1: 6.2, x2: 8, y2: 10, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' } },
    { tag: 'circle', attrs: { cx: 8, cy: 12.1, r: 0.9, fill: 'currentColor' } },
  ],
  caution: [
    { tag: 'polygon', attrs: { points: '5,1.3 11,1.3 14.7,5 14.7,11 11,14.7 5,14.7 1.3,11 1.3,5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round' } },
    { tag: 'line', attrs: { x1: 8, y1: 5.6, x2: 8, y2: 9.4, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' } },
    { tag: 'circle', attrs: { cx: 8, cy: 11.4, r: 0.9, fill: 'currentColor' } },
  ],
}

// Tailwind utility classes per type — this codebase has a single dark theme
// (no light/dark toggle; see tailwind.config.js's obsidian* CSS-variable
// colors), so unlike a two-theme app these don't need `dark:` variants.
// Matches GitHub's own five-color alert palette.
export const CALLOUT_STYLES: Record<CalloutType, { border: string; text: string; bg: string }> = {
  note: { border: 'border-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/10' },
  tip: { border: 'border-green-500', text: 'text-green-400', bg: 'bg-green-500/10' },
  important: { border: 'border-purple-500', text: 'text-purple-400', bg: 'bg-purple-500/10' },
  warning: { border: 'border-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  caution: { border: 'border-red-500', text: 'text-red-400', bg: 'bg-red-500/10' },
}
