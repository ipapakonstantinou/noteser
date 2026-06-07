'use client'

// Curated virtual-DOM renderer for plugin output.
//
// Plugins emit a small set of VNode shapes via ctx.setPanelContent or
// ctx.renderCodeBlock; the host maps each shape to a real React tree
// here. v1 shipped two shapes (`text`, `callout`). v1.2 adds seven
// more (`button`, `input`, `list`, `link`, `radio`, `svg`, `box`) per
// `docs/plugins-v1.2-plan.md` section 2.
//
// Why curated and not raw HTML / React: plugins run in a Worker, the
// Worker has no DOM, so the only thing it CAN emit is data. Mapping
// data to React inside this single module means the worker cannot
// inject script, style, or arbitrary attributes. One audit surface.
//
// Sanitisation: every plugin-supplied string renders as React text
// content via the children slot; the renderer never reaches React's
// raw-HTML escape hatch. React's default escape handles `<`, `>`,
// `&`, `"`, `'` in text nodes for us; we add `escapeText` for the
// rare paths that build a string before handing it to React (e.g.
// SVG path/attribute coercion comments). Numeric props are coerced
// via `coerceFinite` and rejected on NaN / Infinity. A static-source
// guard in `src/__tests__/markdownXssGuard.test.tsx` pins this rule
// across the whole `src/` tree.
//
// Event handlers are NOT functions. Plugins declare event intent as
// `{ kind: 'emit', event: string, payload?: unknown }`; the renderer
// turns that into a DOM event listener that posts the event back
// through the wire protocol via the `onEvent` prop. PR B (fullscreen)
// and the capability PRs consume the same shape.
//
// All shapes carry `tag` as discriminator.

import type { CSSProperties, ReactNode } from 'react'

// ─── v1 shapes (unchanged) ────────────────────────────────────────────────

export interface VNodeText {
  tag: 'text'
  value: string
}

export interface VNodeCallout {
  tag: 'callout'
  /** Visual kind. Unknown values render as 'note'. */
  kind?: 'note' | 'warn' | 'tip' | 'danger' | 'info'
  /** Optional title shown bold on the first line. */
  title?: string
  /** Body text (no markup). */
  body: string
}

// ─── v1.2 event shape ─────────────────────────────────────────────────────

/**
 * Plugin-declared event intent. Functions cannot survive postMessage,
 * so plugins emit this record on `onClick` / `onChange` instead of a
 * callback. The renderer dispatches a `PluginVNodeEvent` upstream via
 * the `onEvent` prop; the worker matches by `event` name against the
 * handlers the plugin registered via `ctx.onVNodeEvent` (wired in a
 * later v1.2 PR).
 */
export interface VNodeEvent {
  kind: 'emit'
  /** Plugin-defined event name. Host treats as opaque. */
  event: string
  /** Optional payload echoed back on the wire. */
  payload?: unknown
}

/**
 * Wire-level event message emitted by the renderer when a plugin's
 * control (button / input / radio / clickable svg shape) fires. This
 * is the contract every later v1.2 PR consumes — surfaces (panel,
 * fullscreen, code block) wrap the dispatcher and add their `source`
 * descriptor before the message hits `host:vnodeEvent` on the wire
 * (see `protocol.ts`).
 */
export interface PluginVNodeEvent {
  /** Plugin-defined event name, echoed from `VNodeEvent.event`. */
  event: string
  /**
   * Payload posted back to the worker. For inputs and radios the
   * renderer augments the plugin-supplied `payload` with `{ value }`;
   * for buttons and clickable svg shapes it is the plugin payload
   * verbatim (or `undefined`).
   */
  payload: unknown
}

// ─── v1.2 new shapes ──────────────────────────────────────────────────────

export interface VNodeButton {
  tag: 'button'
  label: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  onClick?: VNodeEvent
}

export interface VNodeInput {
  tag: 'input'
  type: 'text' | 'number' | 'search' | 'select'
  /** Required when `type === 'select'`; ignored otherwise. */
  options?: ReadonlyArray<{ value: string; label: string }>
  value?: string | number
  placeholder?: string
  disabled?: boolean
  onChange?: VNodeEvent
}

export interface VNodeList {
  tag: 'list'
  ordered?: boolean
  /** Depth-capped at MAX_LIST_DEPTH. Deeper trees fall through to the
   *  JSON dump path in `PluginNode`. */
  items: ReadonlyArray<VNode>
}

export interface VNodeLink {
  tag: 'link'
  label: string
  /**
   * Discriminated union — the renderer constructs the real URL
   * host-side. Plugins cannot produce a raw href string, so
   * `javascript:`, `data:`, `mailto:`, and external URLs are
   * structurally impossible. The `note` variant resolves to a
   * `wikilink://` URL the editor's link layer already understands;
   * the `anchor` variant scrolls to a fragment within the active
   * note.
   */
  href:
    | { kind: 'note'; noteId: string }
    | { kind: 'anchor'; fragment: string }
}

export interface VNodeRadio {
  tag: 'radio'
  /** Group name shared by all radio inputs in the rendered fieldset. */
  group: string
  options: ReadonlyArray<{ value: string; label: string }>
  value?: string
  onChange?: VNodeEvent
}

/**
 * SVG shape primitives. Only the five named tags are allowed; no
 * `<foreignObject>`, no `<use>`, no `<script>`. The renderer rejects
 * any other tag and emits nothing.
 */
export type SvgChild =
  | { tag: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'text'; x: number; y: number; value: string; fontSize?: number; fill?: string }
  | { tag: 'path'; d: string; stroke?: string; fill?: string; strokeWidth?: number }

export interface VNodeSvg {
  tag: 'svg'
  width: number
  height: number
  viewBox?: readonly [number, number, number, number]
  children: ReadonlyArray<SvgChild>
}

export interface VNodeBox {
  tag: 'box'
  children: ReadonlyArray<VNode>
  /** Gap between children, mapped to tailwind spacing. */
  gap?: 0 | 1 | 2 | 3 | 4
}

export type VNode =
  | VNodeText
  | VNodeCallout
  | VNodeButton
  | VNodeInput
  | VNodeList
  | VNodeLink
  | VNodeRadio
  | VNodeSvg
  | VNodeBox

// ─── Renderer constants ───────────────────────────────────────────────────

const CALLOUT_STYLES: Record<NonNullable<VNodeCallout['kind']>, { container: string; icon: string; label: string }> = {
  note: {
    container: 'border-blue-500/40 bg-blue-500/10',
    icon: '📝',
    label: 'Note',
  },
  info: {
    container: 'border-cyan-500/40 bg-cyan-500/10',
    icon: 'ℹ️',
    label: 'Info',
  },
  tip: {
    container: 'border-emerald-500/40 bg-emerald-500/10',
    icon: '💡',
    label: 'Tip',
  },
  warn: {
    container: 'border-amber-500/40 bg-amber-500/10',
    icon: '⚠️',
    label: 'Warning',
  },
  danger: {
    container: 'border-red-500/40 bg-red-500/10',
    icon: '🔴',
    label: 'Danger',
  },
}

const BUTTON_VARIANTS: Record<NonNullable<VNodeButton['variant']>, string> = {
  default:
    'border border-obsidianBorder bg-obsidianHighlight/40 text-obsidianText hover:bg-obsidianHighlight/60',
  primary:
    'border border-blue-500/60 bg-blue-500/30 text-obsidianText hover:bg-blue-500/40',
  danger:
    'border border-red-500/60 bg-red-500/30 text-obsidianText hover:bg-red-500/40',
  ghost:
    'border border-transparent text-obsidianText hover:bg-obsidianHighlight/40',
}

const GAP_CLASSES: Record<NonNullable<VNodeBox['gap']>, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
}

/** Maximum depth a list (and any nested boxes/lists) is allowed to
 *  recurse through the renderer. Deeper trees render the JSON
 *  fallback in `PluginNode`. */
export const MAX_LIST_DEPTH = 8

/** Cap on the length of an SVG `<path d>` string. Path syntax is
 *  non-executable in browsers, but the parser still costs CPU. */
const MAX_PATH_D_LENGTH = 8 * 1024

/** Cap on color-string length before falling back to currentColor. */
const MAX_COLOR_LENGTH = 32

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgb\([^)]*\)|rgba\([^)]*\)|[a-z]+)$/i

// ─── Sanitisation helpers ─────────────────────────────────────────────────

/**
 * Escape `<`, `>`, `&`, `"`, `'` in a plugin-supplied string. React
 * already escapes when a string lands in a children slot; this helper
 * exists so non-children paths (e.g. assembling a string before
 * passing to React) stay safe. The renderer never reaches the raw-
 * HTML escape hatch — see the static-source guard in
 * `src/__tests__/markdownXssGuard.test.tsx`.
 */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function coerceFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_COLOR_LENGTH) return null
  return COLOR_RE.test(value) ? value : null
}

/**
 * Translate a `VNodeLink.href` discriminated union into a real string
 * URL. The plugin never sees this string; the renderer constructs it
 * host-side from typed parts, so `javascript:` and `data:` are
 * structurally unreachable.
 */
function linkHrefToString(href: VNodeLink['href']): string | null {
  if (href.kind === 'note') {
    if (typeof href.noteId !== 'string' || href.noteId.length === 0) return null
    return `wikilink://${encodeURIComponent(href.noteId)}`
  }
  if (href.kind === 'anchor') {
    if (typeof href.fragment !== 'string' || href.fragment.length === 0) return null
    return `#${encodeURIComponent(href.fragment)}`
  }
  return null
}

/**
 * Belt-and-braces guard for raw hrefs. Even though the discriminated
 * union makes `javascript:` etc. unreachable, the helper exists as a
 * named contract the tests can assert on — and lets later changes
 * (e.g. an opt-in raw href shape) gate through one chokepoint.
 */
export function isSafePluginHref(href: string): boolean {
  if (typeof href !== 'string' || href.length === 0) return false
  if (href.startsWith('wikilink://')) return true
  if (href.startsWith('#')) return true
  if (href.startsWith('/') && !href.startsWith('//')) return true
  return false
}

// ─── Event dispatch plumbing ──────────────────────────────────────────────

export type PluginVNodeEventDispatcher = (event: PluginVNodeEvent) => void

interface RenderContext {
  /** Optional. When absent the renderer drops events on the floor; the
   *  panel surface always wires one, but a JSON-dump fallback path in
   *  isolation does not need to. */
  onEvent?: PluginVNodeEventDispatcher
  /** Current depth into list / box recursion. */
  depth: number
}

function dispatchOrDrop(ctx: RenderContext, evt: VNodeEvent | undefined, valueOverride?: { value: string | number }): void {
  if (!ctx.onEvent) return
  if (!evt || evt.kind !== 'emit' || typeof evt.event !== 'string' || evt.event.length === 0) return
  const payload = valueOverride !== undefined
    ? (typeof evt.payload === 'object' && evt.payload !== null
        ? { ...(evt.payload as Record<string, unknown>), ...valueOverride }
        : valueOverride)
    : evt.payload
  ctx.onEvent({ event: evt.event, payload })
}

// ─── Renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single VNode received from a plugin. Returns null when the
 * shape is unrecognised — the caller decides whether to show a
 * fallback (JSON dump for debug, an error pane in prod).
 *
 * `onEvent` receives wire-level event messages every time a rendered
 * control (button click, input change, radio pick, clickable svg
 * shape) fires. Surfaces (sidebar panel, code block, future
 * fullscreen view in PR B) wrap this dispatcher.
 */
export function renderPluginVNode(node: unknown, onEvent?: PluginVNodeEventDispatcher): ReactNode | null {
  return renderWithContext(node, { onEvent, depth: 0 })
}

function renderWithContext(node: unknown, ctx: RenderContext): ReactNode | null {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || !('tag' in node)) return null

  const tag = (node as { tag: unknown }).tag

  if (tag === 'text') return renderText(node as VNodeText)
  if (tag === 'callout') return renderCallout(node as VNodeCallout)
  if (tag === 'button') return renderButton(node as VNodeButton, ctx)
  if (tag === 'input') return renderInput(node as VNodeInput, ctx)
  if (tag === 'list') return renderList(node as VNodeList, ctx)
  if (tag === 'link') return renderLink(node as VNodeLink)
  if (tag === 'radio') return renderRadio(node as VNodeRadio, ctx)
  if (tag === 'svg') return renderSvg(node as VNodeSvg, ctx)
  if (tag === 'box') return renderBox(node as VNodeBox, ctx)

  return null
}

function renderText(v: VNodeText): ReactNode | null {
  if (typeof v.value !== 'string') return null
  // React escapes the children slot; the string lands as text content.
  return <span>{v.value}</span>
}

function renderCallout(v: VNodeCallout): ReactNode | null {
  if (typeof v.body !== 'string') return null
  const kind = v.kind && v.kind in CALLOUT_STYLES ? v.kind : 'note'
  const style = CALLOUT_STYLES[kind]
  return (
    <div className={`rounded-md border px-3 py-2 ${style.container}`}>
      <div className="text-xs uppercase tracking-wide text-obsidianText/80 mb-1">
        <span className="mr-1.5">{style.icon}</span>
        {v.title && v.title.length > 0 ? v.title : style.label}
      </div>
      <div className="text-sm text-obsidianText whitespace-pre-wrap">{v.body}</div>
    </div>
  )
}

function renderButton(v: VNodeButton, ctx: RenderContext): ReactNode | null {
  if (typeof v.label !== 'string') return null
  const variant = v.variant && v.variant in BUTTON_VARIANTS ? v.variant : 'default'
  const disabled = v.disabled === true
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${BUTTON_VARIANTS[variant]} disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={
        disabled
          ? undefined
          : () => dispatchOrDrop(ctx, v.onClick)
      }
    >
      {v.label}
    </button>
  )
}

function renderInput(v: VNodeInput, ctx: RenderContext): ReactNode | null {
  if (v.type !== 'text' && v.type !== 'number' && v.type !== 'search' && v.type !== 'select') {
    return null
  }
  const disabled = v.disabled === true
  const baseClass =
    'rounded-md border border-obsidianBorder bg-obsidianHighlight/30 px-2 py-1 text-sm text-obsidianText placeholder:text-obsidianSecondaryText focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50'

  if (v.type === 'select') {
    const options = Array.isArray(v.options) ? v.options : []
    return (
      <select
        className={baseClass}
        disabled={disabled}
        value={typeof v.value === 'string' || typeof v.value === 'number' ? String(v.value) : ''}
        onChange={
          disabled
            ? undefined
            : (e) => dispatchOrDrop(ctx, v.onChange, { value: e.target.value })
        }
      >
        {options.map((opt, idx) => {
          if (typeof opt?.value !== 'string' || typeof opt?.label !== 'string') return null
          return (
            <option key={`${opt.value}:${idx}`} value={opt.value}>
              {opt.label}
            </option>
          )
        })}
      </select>
    )
  }

  const value =
    typeof v.value === 'string' || typeof v.value === 'number' ? String(v.value) : ''
  return (
    <input
      type={v.type}
      className={baseClass}
      disabled={disabled}
      placeholder={typeof v.placeholder === 'string' ? v.placeholder : undefined}
      value={value}
      onChange={
        disabled
          ? undefined
          : (e) => {
              const next = v.type === 'number' ? Number(e.target.value) : e.target.value
              dispatchOrDrop(ctx, v.onChange, { value: next })
            }
      }
    />
  )
}

function renderList(v: VNodeList, ctx: RenderContext): ReactNode | null {
  if (!Array.isArray(v.items)) return null
  if (ctx.depth + 1 > MAX_LIST_DEPTH) return null
  const childCtx: RenderContext = { onEvent: ctx.onEvent, depth: ctx.depth + 1 }
  const ordered = v.ordered === true
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 text-sm text-obsidianText space-y-1`}>
      {v.items.map((item, idx) => {
        const rendered = renderWithContext(item, childCtx)
        if (rendered === null) return null
        return <li key={idx}>{rendered}</li>
      })}
    </Tag>
  )
}

function renderLink(v: VNodeLink): ReactNode | null {
  if (typeof v.label !== 'string' || v.label.length === 0) return null
  if (typeof v.href !== 'object' || v.href === null || !('kind' in v.href)) return null
  const href = linkHrefToString(v.href as VNodeLink['href'])
  if (href === null) return null
  // Belt-and-braces — the helper above already restricts to wikilink://
  // and #fragment, but the named guard keeps the security contract
  // explicit at the render site.
  if (!isSafePluginHref(href)) return null
  return (
    <a
      href={href}
      className="text-blue-500 underline hover:text-blue-400"
      rel="noopener noreferrer"
    >
      {v.label}
    </a>
  )
}

function renderRadio(v: VNodeRadio, ctx: RenderContext): ReactNode | null {
  if (typeof v.group !== 'string' || v.group.length === 0) return null
  if (!Array.isArray(v.options)) return null
  const current = typeof v.value === 'string' ? v.value : undefined
  return (
    <fieldset className="flex flex-col gap-1">
      {v.options.map((opt, idx) => {
        if (typeof opt?.value !== 'string' || typeof opt?.label !== 'string') return null
        const checked = current === opt.value
        const id = `plugin-radio-${v.group}-${idx}`
        return (
          <label key={`${opt.value}:${idx}`} htmlFor={id} className="flex items-center gap-2 text-sm text-obsidianText">
            <input
              id={id}
              type="radio"
              name={`plugin-radio-${v.group}`}
              value={opt.value}
              checked={checked}
              onChange={() => dispatchOrDrop(ctx, v.onChange, { value: opt.value })}
              className="accent-blue-500"
            />
            <span>{opt.label}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

function renderSvg(v: VNodeSvg, ctx: RenderContext): ReactNode | null {
  const width = coerceFinite(v.width)
  const height = coerceFinite(v.height)
  if (width === null || height === null) return null
  if (!Array.isArray(v.children)) return null
  let viewBox: string | undefined
  if (Array.isArray(v.viewBox) && v.viewBox.length === 4) {
    const parts = v.viewBox.map((n) => coerceFinite(n))
    if (parts.every((n): n is number => n !== null)) {
      viewBox = parts.join(' ')
    }
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      {v.children.map((child, idx) => renderSvgChild(child, idx, ctx))}
    </svg>
  )
}

function renderSvgChild(child: SvgChild | unknown, key: number, ctx: RenderContext): ReactNode | null {
  if (typeof child !== 'object' || child === null || !('tag' in child)) return null
  const tag = (child as { tag: unknown }).tag

  if (tag === 'line') {
    const c = child as Extract<SvgChild, { tag: 'line' }>
    const x1 = coerceFinite(c.x1)
    const y1 = coerceFinite(c.y1)
    const x2 = coerceFinite(c.x2)
    const y2 = coerceFinite(c.y2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    const stroke = safeColor(c.stroke) ?? 'currentColor'
    const strokeWidth = coerceFinite(c.strokeWidth) ?? 1
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} />
  }

  if (tag === 'circle') {
    const c = child as Extract<SvgChild, { tag: 'circle' }>
    const cx = coerceFinite(c.cx)
    const cy = coerceFinite(c.cy)
    const r = coerceFinite(c.r)
    if (cx === null || cy === null || r === null) return null
    const fill = safeColor(c.fill) ?? 'currentColor'
    const stroke = safeColor(c.stroke) ?? 'none'
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={stroke}
        onClick={c.onClick ? () => dispatchOrDrop(ctx, c.onClick) : undefined}
        style={c.onClick ? ({ cursor: 'pointer' } satisfies CSSProperties) : undefined}
      />
    )
  }

  if (tag === 'rect') {
    const c = child as Extract<SvgChild, { tag: 'rect' }>
    const x = coerceFinite(c.x)
    const y = coerceFinite(c.y)
    const width = coerceFinite(c.width)
    const height = coerceFinite(c.height)
    if (x === null || y === null || width === null || height === null) return null
    const fill = safeColor(c.fill) ?? 'currentColor'
    const stroke = safeColor(c.stroke) ?? 'none'
    return (
      <rect
        key={key}
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke={stroke}
        onClick={c.onClick ? () => dispatchOrDrop(ctx, c.onClick) : undefined}
        style={c.onClick ? ({ cursor: 'pointer' } satisfies CSSProperties) : undefined}
      />
    )
  }

  if (tag === 'text') {
    const c = child as Extract<SvgChild, { tag: 'text' }>
    const x = coerceFinite(c.x)
    const y = coerceFinite(c.y)
    if (x === null || y === null) return null
    if (typeof c.value !== 'string') return null
    const fontSize = coerceFinite(c.fontSize) ?? 12
    const fill = safeColor(c.fill) ?? 'currentColor'
    return (
      <text key={key} x={x} y={y} fontSize={fontSize} fill={fill}>
        {c.value}
      </text>
    )
  }

  if (tag === 'path') {
    const c = child as Extract<SvgChild, { tag: 'path' }>
    if (typeof c.d !== 'string' || c.d.length === 0) return null
    if (c.d.length > MAX_PATH_D_LENGTH) return null
    const stroke = safeColor(c.stroke) ?? 'currentColor'
    const fill = safeColor(c.fill) ?? 'none'
    const strokeWidth = coerceFinite(c.strokeWidth) ?? 1
    return <path key={key} d={c.d} stroke={stroke} fill={fill} strokeWidth={strokeWidth} />
  }

  return null
}

function renderBox(v: VNodeBox, ctx: RenderContext): ReactNode | null {
  if (!Array.isArray(v.children)) return null
  if (ctx.depth + 1 > MAX_LIST_DEPTH) return null
  const childCtx: RenderContext = { onEvent: ctx.onEvent, depth: ctx.depth + 1 }
  const gap = v.gap !== undefined && v.gap in GAP_CLASSES ? GAP_CLASSES[v.gap] : 'gap-2'
  return (
    <div className={`flex flex-col ${gap}`}>
      {v.children.map((child, idx) => {
        const rendered = renderWithContext(child, childCtx)
        if (rendered === null) return null
        return <div key={idx}>{rendered}</div>
      })}
    </div>
  )
}

/**
 * Render-or-fallback. Unrecognised shapes show a JSON dump in dev so
 * plugin authors can spot a typo, and the same dump in prod (we do
 * not strip it — the surface area is too small to bother gating).
 *
 * Pass `onEvent` to wire VNode events back into the host. Surfaces
 * that need event delivery (the sidebar plugin panel, the code-block
 * renderer, the future fullscreen view in PR B) all wrap this prop.
 */
export function PluginNode({
  node,
  onEvent,
}: {
  node: unknown
  onEvent?: PluginVNodeEventDispatcher
}) {
  const rendered = renderPluginVNode(node, onEvent)
  if (rendered !== null) return <>{rendered}</>
  return (
    <pre className="text-xs font-mono text-obsidianSecondaryText whitespace-pre-wrap">
      {JSON.stringify(node, null, 2)}
    </pre>
  )
}
