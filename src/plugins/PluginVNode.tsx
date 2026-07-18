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

import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { SURFACE_TRANSFORM_EVENT, type InteractionKind } from './protocol'
import { NODE_ID_ATTR, EDGE_SOURCE_ATTR, EDGE_TARGET_ATTR } from './svgPositionPatch'

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

// ─── v1.3 (L1) pointer-event handler props ────────────────────────────────
//
// Same `VNodeEvent` record shape as the v1.2 handlers (`onClick` etc).
// A listener is attached ONLY when the prop is present, so absence is
// exactly v1.2 behaviour with zero added cost. L1 ships the three
// discrete/continuous pointer handlers below; `onWheel` (L2) and
// `onPointerEnter` / `onPointerLeave` (L3) are deliberately NOT part of
// this PR.

/** Pointer + hover handler set. `onPointerMove` (L1) and
 *  `onPointerEnter` / `onPointerLeave` (L3) are high-frequency — the
 *  host rAF-coalesces them and draws them from a separate budget gated
 *  on the matching manifest `interaction` sub-flag (`pointer` for move,
 *  `hover` for enter/leave); `onPointerDown` / `onPointerUp` are
 *  discrete. A listener is attached only when its prop is present. */
export interface PointerHandlers {
  onPointerDown?: VNodeEvent
  onPointerMove?: VNodeEvent
  onPointerUp?: VNodeEvent
  /** v1.3 (L3) — high-frequency, coalesced, gated on `interaction.hover`. */
  onPointerEnter?: VNodeEvent
  /** v1.3 (L3) — high-frequency, coalesced, gated on `interaction.hover`. */
  onPointerLeave?: VNodeEvent
}

/** v1.3 (L2) — wheel handler. `onWheel` is high-frequency: the host
 *  rAF-coalesces it and draws it from the separate budget, gated on
 *  `interaction.wheel`. Lives on `VNodeSvg` + `VNodeBox` only. */
export interface WheelHandlers {
  onWheel?: VNodeEvent
}

/**
 * Payload the host augments onto every pointer event before it crosses
 * the wire. Host keys win the shallow merge over any plugin-supplied
 * payload, so a plugin cannot spoof coordinates or the target id. Only
 * numbers, a boolean-free set here, and the echoed `target` string
 * cross — never a DOM ref or the raw event object.
 *
 * `x` / `y` are surface coordinates (see the coordinate-system contract
 * below): SVG user-space for svg surfaces, element-local pixels for box
 * surfaces. `button` is 0 primary / 1 middle / 2 secondary on
 * down / up and -1 on move. `target` is the opt-in `id` declared on the
 * owning shape / svg / box, or null when none was declared.
 */
export interface PointerEventPayload {
  x: number
  y: number
  button: number
  pointerId: number
  target: string | null
}

/**
 * v1.3 (L2) — payload the host augments onto a wheel event. `x` / `y`
 * are the focal point in the same coordinate space as pointer events
 * (SVG user-space for svg surfaces via the inverse screen CTM,
 * element-local pixels for box surfaces). `ctrlKey` is true for a
 * trackpad pinch (the browser reports pinch as ctrl+wheel). Host keys
 * win the shallow merge, so a plugin payload cannot spoof the deltas /
 * coords. */
export interface WheelEventPayload {
  deltaX: number
  deltaY: number
  x: number
  y: number
  ctrlKey: boolean
}

/**
 * v1.3 (L3) — payload the host augments onto a hover enter/leave event.
 * `target` is the opt-in `id` on the owning shape/svg/box (or null);
 * `x` / `y` are the pointer position in the surface coordinate space.
 * No DOM ref crosses the wire. */
export interface HoverEventPayload {
  target: string | null
  x: number
  y: number
}

export type { InteractionKind }

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
   * verbatim (or `undefined`); for pointer events it is the
   * `PointerEventPayload` shallow-merged over the plugin payload.
   */
  payload: unknown
  /**
   * v1.3 (L1) — set true for high-frequency events (`onPointerMove`)
   * so the surface adapter can ask the host to rAF-coalesce them and
   * charge them to the separate high-frequency budget. Discrete events
   * (clicks, pointerdown / pointerup, input changes) leave it unset.
   * The host treats an unset flag as a normal discrete event.
   */
  highFrequency?: boolean
  /**
   * v1.3 (L2/L3) — which `interaction` sub-flag this high-frequency
   * event belongs to, so the host gates it on the right manifest opt-in
   * (`pointer` for move, `wheel` for wheel, `hover` for enter/leave).
   * Unset on discrete events; the host defaults a high-frequency event
   * with no kind to `'pointer'` (L1 behaviour).
   */
  interaction?: InteractionKind
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
  | {
      tag: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      stroke?: string
      strokeWidth?: number
      /** v1.3 (L4) — node id this edge's first endpoint (`x1`/`y1`)
       *  follows. The position-patch fast path moves the endpoint when a
       *  patch for this id arrives, without a full re-render. */
      sourceId?: string
      /** v1.3 (L4) — node id this edge's second endpoint (`x2`/`y2`)
       *  follows. */
      targetId?: string
    }
  | ({
      tag: 'circle'
      cx: number
      cy: number
      r: number
      fill?: string
      stroke?: string
      /** v1.3 (L1) — echoed back as `payload.target` on pointer events. */
      id?: string
      onClick?: VNodeEvent
    } & PointerHandlers)
  | ({
      tag: 'rect'
      x: number
      y: number
      width: number
      height: number
      fill?: string
      stroke?: string
      /** v1.3 (L1) — echoed back as `payload.target` on pointer events. */
      id?: string
      onClick?: VNodeEvent
    } & PointerHandlers)
  | { tag: 'text'; x: number; y: number; value: string; fontSize?: number; fill?: string }
  | { tag: 'path'; d: string; stroke?: string; fill?: string; strokeWidth?: number }

export interface VNodeSvg extends PointerHandlers, WheelHandlers {
  tag: 'svg'
  width: number
  height: number
  viewBox?: readonly [number, number, number, number]
  /** v1.3 (L1) — surface-level id, echoed as `payload.target` on
   *  pointer events that fire on the svg element itself. */
  id?: string
  /**
   * v1.3 (L2) — when set to `'host'`, the host OWNS the viewBox
   * transform locally. It interprets surface-level drag (pan) and wheel
   * (zoom) into a viewBox applied directly to the rendered `<svg>` with
   * NO worker round-trip (instant 60fps), and emits exactly one
   * `surface.transform` event (`{ x, y, scale }`) on gesture settle so
   * the plugin can persist + sync its viewport. While host pan/zoom is
   * active the svg's own surface-level pointer/wheel handlers are NOT
   * forwarded to the plugin (the host consumes them); child-shape
   * handlers (e.g. a draggable circle) still fire normally.
   */
  panZoom?: 'host'
  children: ReadonlyArray<SvgChild>
}

export interface VNodeBox extends PointerHandlers, WheelHandlers {
  tag: 'box'
  children: ReadonlyArray<VNode>
  /** Gap between children, mapped to tailwind spacing. */
  gap?: 0 | 1 | 2 | 3 | 4
  /** v1.3 (L1) — surface-level id, echoed as `payload.target` on
   *  pointer events that fire on the box element. */
  id?: string
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

// ─── v1.3 (L1) pointer dispatch + coordinate mapping ──────────────────────
//
// One chokepoint, mirroring `dispatchOrDrop`. Pointer events ride the
// exact same emit channel; the only new work is (a) mapping client
// coordinates into the surface's coordinate space and (b) shallow-
// merging the host-controlled `PointerEventPayload` over the plugin's
// payload (host keys win, so coords / target cannot be spoofed).

/** Minimal shape of an SVG screen CTM — the affine matrix
 *  `getScreenCTM()` returns. Kept structural so the inverse math is
 *  unit-testable without a real DOMMatrix (jsdom returns null). */
interface AffineMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * Map a screen-space point back into SVG user space by inverting the
 * screen CTM. `getScreenCTM()` gives `screen = M · user`:
 *   screenX = a·userX + c·userY + e
 *   screenY = b·userX + d·userY + f
 * so the inverse is computed directly from the matrix entries. Done by
 * hand rather than via `DOMPoint.matrixTransform` so it survives jsdom
 * and stays a pure, testable function. Returns the raw screen point
 * unchanged when the matrix is degenerate (det ≈ 0).
 */
export function inverseCTMPoint(
  m: AffineMatrix,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const det = m.a * m.d - m.b * m.c
  if (det === 0 || !Number.isFinite(det)) return { x: screenX, y: screenY }
  const dx = screenX - m.e
  const dy = screenY - m.f
  return {
    x: (m.d * dx - m.c * dy) / det,
    y: (m.a * dy - m.b * dx) / det,
  }
}

/** Map a client point to element-local pixels for a box surface. */
export function mapBoxPoint(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/** Coordinate space a surface maps pointer coordinates into. */
type PointerCoordKind = 'svg' | 'box'

function pointerSurfacePoint(
  el: Element,
  coordKind: PointerCoordKind,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (coordKind === 'svg') {
    const getCTM = (el as unknown as { getScreenCTM?: () => AffineMatrix | null }).getScreenCTM
    const ctm = typeof getCTM === 'function' ? getCTM.call(el) : null
    if (ctm) return inverseCTMPoint(ctm, clientX, clientY)
    // jsdom / detached node: no CTM. Fall back to raw client coords so
    // the contract (numbers, never NaN) holds.
    return { x: clientX, y: clientY }
  }
  const rect = el.getBoundingClientRect()
  return mapBoxPoint(rect, clientX, clientY)
}

/**
 * Dispatch a pointer event through the emit channel, augmenting the
 * payload with the host-controlled `PointerEventPayload`. `isMove`
 * marks the high-frequency path (forces `button: -1`, flags the event
 * as `highFrequency` so the host coalesces it). `id` is the opt-in
 * shape / surface id echoed as `payload.target`.
 */
function dispatchPointer(
  ctx: RenderContext,
  el: Element,
  evt: VNodeEvent | undefined,
  e: ReactPointerEvent,
  opts: { id: string | undefined; coordKind: PointerCoordKind; isMove: boolean },
): void {
  if (!ctx.onEvent) return
  if (!evt || evt.kind !== 'emit' || typeof evt.event !== 'string' || evt.event.length === 0) return
  const { x, y } = pointerSurfacePoint(el, opts.coordKind, e.clientX, e.clientY)
  const hostKeys: PointerEventPayload = {
    x,
    y,
    button: opts.isMove ? -1 : e.button,
    pointerId: e.pointerId,
    target: typeof opts.id === 'string' ? opts.id : null,
  }
  // Host keys win the shallow merge — a plugin payload cannot override
  // coords / target / pointerId.
  const payload =
    typeof evt.payload === 'object' && evt.payload !== null
      ? { ...(evt.payload as Record<string, unknown>), ...hostKeys }
      : hostKeys
  ctx.onEvent({
    event: evt.event,
    payload,
    ...(opts.isMove ? { highFrequency: true, interaction: 'pointer' as const } : {}),
  })
}

/**
 * v1.3 (L3) — dispatch a hover enter/leave event. High-frequency: the
 * host coalesces it and gates it on `interaction.hover`. Payload is the
 * host-controlled `HoverEventPayload` shallow-merged over the plugin
 * payload (host keys win). Coordinates use the same surface mapping as
 * pointer events.
 */
function dispatchHover(
  ctx: RenderContext,
  el: Element,
  evt: VNodeEvent | undefined,
  e: ReactPointerEvent,
  opts: { id: string | undefined; coordKind: PointerCoordKind },
): void {
  if (!ctx.onEvent) return
  if (!evt || evt.kind !== 'emit' || typeof evt.event !== 'string' || evt.event.length === 0) return
  const { x, y } = pointerSurfacePoint(el, opts.coordKind, e.clientX, e.clientY)
  const hostKeys: HoverEventPayload = {
    target: typeof opts.id === 'string' ? opts.id : null,
    x,
    y,
  }
  const payload =
    typeof evt.payload === 'object' && evt.payload !== null
      ? { ...(evt.payload as Record<string, unknown>), ...hostKeys }
      : hostKeys
  ctx.onEvent({ event: evt.event, payload, highFrequency: true, interaction: 'hover' })
}

/**
 * v1.3 (L2) — dispatch a wheel event. High-frequency: the host
 * coalesces it and gates it on `interaction.wheel`. Payload is the
 * host-controlled `WheelEventPayload` (deltas + focal coords + ctrlKey)
 * shallow-merged over the plugin payload (host keys win). `x` / `y` use
 * the same surface coordinate mapping as pointer events.
 */
function dispatchWheel(
  ctx: RenderContext,
  el: Element,
  evt: VNodeEvent | undefined,
  e: WheelEvent,
  opts: { coordKind: PointerCoordKind },
): void {
  if (!ctx.onEvent) return
  if (!evt || evt.kind !== 'emit' || typeof evt.event !== 'string' || evt.event.length === 0) return
  const { x, y } = pointerSurfacePoint(el, opts.coordKind, e.clientX, e.clientY)
  const hostKeys: WheelEventPayload = {
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    x,
    y,
    ctrlKey: e.ctrlKey === true,
  }
  const payload =
    typeof evt.payload === 'object' && evt.payload !== null
      ? { ...(evt.payload as Record<string, unknown>), ...hostKeys }
      : hostKeys
  ctx.onEvent({ event: evt.event, payload, highFrequency: true, interaction: 'wheel' })
}

/**
 * Build the React pointer-listener props for a shape / surface. A
 * listener is attached ONLY for a handler the plugin actually declared,
 * so a node with no pointer handlers attaches nothing (v1.2 behaviour,
 * zero cost). When BOTH down and move are declared the down listener
 * also calls `setPointerCapture` so a drag keeps firing move / up even
 * when the pointer leaves the shape — a host-side detail the plugin
 * never sees.
 */
function pointerListenerProps(
  ctx: RenderContext,
  h: PointerHandlers,
  id: string | undefined,
  coordKind: PointerCoordKind,
): {
  onPointerDown?: (e: ReactPointerEvent) => void
  onPointerMove?: (e: ReactPointerEvent) => void
  onPointerUp?: (e: ReactPointerEvent) => void
  onPointerEnter?: (e: ReactPointerEvent) => void
  onPointerLeave?: (e: ReactPointerEvent) => void
} {
  const captureOnDown = h.onPointerDown !== undefined && h.onPointerMove !== undefined
  return {
    ...(h.onPointerDown !== undefined
      ? {
          onPointerDown: (e: ReactPointerEvent) => {
            if (captureOnDown) {
              try {
                ;(e.currentTarget as Element & {
                  setPointerCapture?: (id: number) => void
                }).setPointerCapture?.(e.pointerId)
              } catch {
                // setPointerCapture is best-effort; jsdom + some browsers
                // throw on an inactive pointer. The drag still works
                // without capture, just without the leave-the-shape
                // guarantee.
              }
            }
            dispatchPointer(ctx, e.currentTarget, h.onPointerDown, e, {
              id,
              coordKind,
              isMove: false,
            })
          },
        }
      : {}),
    ...(h.onPointerMove !== undefined
      ? {
          onPointerMove: (e: ReactPointerEvent) =>
            dispatchPointer(ctx, e.currentTarget, h.onPointerMove, e, {
              id,
              coordKind,
              isMove: true,
            }),
        }
      : {}),
    ...(h.onPointerUp !== undefined
      ? {
          onPointerUp: (e: ReactPointerEvent) =>
            dispatchPointer(ctx, e.currentTarget, h.onPointerUp, e, {
              id,
              coordKind,
              isMove: false,
            }),
        }
      : {}),
    ...(h.onPointerEnter !== undefined
      ? {
          onPointerEnter: (e: ReactPointerEvent) =>
            dispatchHover(ctx, e.currentTarget, h.onPointerEnter, e, { id, coordKind }),
        }
      : {}),
    ...(h.onPointerLeave !== undefined
      ? {
          onPointerLeave: (e: ReactPointerEvent) =>
            dispatchHover(ctx, e.currentTarget, h.onPointerLeave, e, { id, coordKind }),
        }
      : {}),
  }
}

// ─── v1.3 (L2) non-passive wheel binding + host-owned pan/zoom ─────────────

/**
 * Attach a non-passive `wheel` listener to `ref.current` so the handler
 * can `preventDefault()` (stop page scroll). React's synthetic `onWheel`
 * is registered passive and cannot cancel the default, so any surface
 * that interprets the wheel (a plugin `onWheel` handler, or host-owned
 * pan/zoom) must bind manually. The handler is read through a ref so the
 * listener is bound once and never needs re-attaching. No listener is
 * attached at all when `enabled` is false — a surface that did not opt
 * into wheel keeps the browser's default passive scroll.
 */
function useNonPassiveWheel(
  ref: { current: Element | null },
  handler: (e: WheelEvent) => void,
  enabled: boolean,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const listener = ((e: Event) => handlerRef.current(e as WheelEvent)) as EventListener
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
    // `enabled` toggling re-binds; `ref` is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

/** Current host-owned viewBox transform. `[minX, minY, w, h]` is the
 *  live viewBox; `baseW` is the initial width used to derive `scale`
 *  (`scale = baseW / w`) for the settle event. */
interface PanZoomState {
  minX: number
  minY: number
  w: number
  h: number
  baseW: number
}

const WHEEL_ZOOM_STEP = 1.0015
const MIN_ZOOM_SCALE = 0.05
const MAX_ZOOM_SCALE = 40

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
    'rounded-md border border-obsidianBorder bg-obsidianHighlight/30 px-2 py-1 text-sm text-obsidianText placeholder:text-obsidianSecondaryText focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50'

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
  // Pull the noteId off the typed `href.kind === 'note'` branch so the
  // click handler can dispatch openNote without re-decoding the URL.
  // Same goes for the anchor fragment — keeps the security contract on
  // the typed shape, not on string parsing.
  const noteId = v.href.kind === 'note' ? v.href.noteId : null
  return (
    <a
      href={href}
      className="text-blue-500 underline hover:text-blue-400"
      rel="noopener noreferrer"
      onClick={(e) => handlePluginLinkClick(e, href, noteId)}
    >
      {v.label}
    </a>
  )
}

/**
 * Click handler for plugin-rendered `<a>` shapes. The renderer emits
 * two URL forms via `linkHrefToString`:
 *   - `wikilink://<encodedNoteId>` for `{ kind: 'note' }` links
 *   - `#<encodedFragment>` for `{ kind: 'anchor' }` links
 *
 * Browser navigation to `wikilink://` does nothing (unknown scheme), so
 * the renderer must intercept the click and dispatch the host's
 * `workspaceStore.openNote(noteId)` action instead. The `noteId` lives
 * on the typed `VNodeLink.href.kind === 'note'` branch — we pass it
 * down here rather than re-decoding the URL string so the parsing
 * surface stays at one chokepoint (`linkHrefToString`).
 *
 * Anchor (`#fragment`) links keep default browser behaviour, which is
 * the native anchor-scroll inside the document.
 *
 * Documented in `docs/plugins-v1.2-impl-notes.md` under "Post-v1.2:
 * VNode event delivery + wikilink intercept".
 */
function handlePluginLinkClick(
  e: MouseEvent<HTMLAnchorElement>,
  href: string,
  noteId: string | null,
): void {
  // Anchor / fragment links — let the browser do its thing.
  if (!href.startsWith('wikilink://')) return
  // Modifier-click should follow native semantics (no-op for an
  // unrecognised scheme); we only intercept the unmodified primary
  // click so a power user is not surprised.
  if (e.defaultPrevented) return
  if (e.button !== 0) return
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  if (noteId === null) return
  useWorkspaceStore.getState().openNote(noteId)
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

/** Parse the numeric viewBox, defaulting to `[0, 0, width, height]`
 *  when the plugin omitted it or supplied a malformed one. */
function resolveViewBox(
  v: VNodeSvg,
  width: number,
  height: number,
): [number, number, number, number] {
  if (Array.isArray(v.viewBox) && v.viewBox.length === 4) {
    const parts = v.viewBox.map((n) => coerceFinite(n))
    if (parts.every((n): n is number => n !== null)) {
      return parts as [number, number, number, number]
    }
  }
  return [0, 0, width, height]
}

function renderSvg(v: VNodeSvg, ctx: RenderContext): ReactNode | null {
  const width = coerceFinite(v.width)
  const height = coerceFinite(v.height)
  if (width === null || height === null) return null
  if (!Array.isArray(v.children)) return null
  // The svg surface owns hooks (non-passive wheel + host pan/zoom state),
  // so it must be a real component, not inline JSX. Keyed by id so a
  // changed surface id remounts (and the pan/zoom state resets).
  return <PluginSvg v={v} width={width} height={height} ctx={ctx} key={v.id ?? undefined} />
}

/**
 * v1.3 — svg surface component. Renders the curated `<svg>` plus its
 * children, and (when opted in) wires the L2 wheel + host-owned pan/zoom
 * paths. Plain (no wheel / no panZoom) svg surfaces behave exactly as
 * v1.2/L1: pointer + hover listeners via React props, no wheel listener,
 * no extra DOM work.
 */
function PluginSvg({
  v,
  width,
  height,
  ctx,
}: {
  v: VNodeSvg
  width: number
  height: number
  ctx: RenderContext
}): ReactNode {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const hostPanZoom = v.panZoom === 'host'
  const hasPluginWheel = v.onWheel !== undefined
  // A wheel listener is needed for either the plugin's own onWheel or
  // host pan/zoom. Both need non-passive binding (preventDefault).
  const wheelEnabled = hostPanZoom || hasPluginWheel

  const [vbMinX, vbMinY, vbW, vbH] = resolveViewBox(v, width, height)
  const initialViewBox = `${vbMinX} ${vbMinY} ${vbW} ${vbH}`

  // Live host-owned transform. Initialised from the rendered viewBox the
  // first time the svg mounts; mutated DIRECTLY on the DOM during a
  // gesture so pan/zoom never round-trips through the worker or a React
  // re-render.
  const pzRef = useRef<PanZoomState>({ minX: vbMinX, minY: vbMinY, w: vbW, h: vbH, baseW: vbW })
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startMinX: number
    startMinY: number
  } | null>(null)
  const wheelIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyViewBox = (): void => {
    const el = svgRef.current
    const pz = pzRef.current
    if (el) el.setAttribute('viewBox', `${pz.minX} ${pz.minY} ${pz.w} ${pz.h}`)
  }

  const emitTransform = (): void => {
    if (!ctx.onEvent) return
    const pz = pzRef.current
    const scale = pz.w !== 0 ? pz.baseW / pz.w : 1
    // ONE discrete settle event carrying the final viewport. Reserved
    // host event name; rides the existing host:vnodeEvent envelope.
    ctx.onEvent({
      event: SURFACE_TRANSFORM_EVENT,
      payload: { x: pz.minX, y: pz.minY, scale },
    })
  }

  const onWheel = (e: WheelEvent): void => {
    if (hostPanZoom) {
      // Host owns the zoom — never let it scroll the page, and never
      // forward it to the plugin (the settle event covers persistence).
      e.preventDefault()
      const pz = pzRef.current
      const focal = pointerSurfacePoint(
        svgRef.current as unknown as Element,
        'svg',
        e.clientX,
        e.clientY,
      )
      const zoomFactor = Math.pow(WHEEL_ZOOM_STEP, -e.deltaY)
      let newW = pz.w / zoomFactor
      // Clamp on absolute scale so a fling cannot invert or explode.
      const minW = pz.baseW / MAX_ZOOM_SCALE
      const maxW = pz.baseW / MIN_ZOOM_SCALE
      newW = Math.min(Math.max(newW, minW), maxW)
      const ratio = newW / pz.w
      const newH = pz.h * ratio
      pz.minX = focal.x - (focal.x - pz.minX) * ratio
      pz.minY = focal.y - (focal.y - pz.minY) * ratio
      pz.w = newW
      pz.h = newH
      applyViewBox()
      // Debounce the settle event — emit ONE transform after the wheel
      // goes idle, not one per notch.
      if (wheelIdleRef.current !== null) clearTimeout(wheelIdleRef.current)
      wheelIdleRef.current = setTimeout(() => {
        wheelIdleRef.current = null
        emitTransform()
      }, 150)
      return
    }
    // Plugin-owned wheel handler: stop page scroll, dispatch the event
    // (coalesced + gated on interaction.wheel host-side).
    if (hasPluginWheel) {
      e.preventDefault()
      dispatchWheel(ctx, svgRef.current as unknown as Element, v.onWheel, e, { coordKind: 'svg' })
    }
  }

  useNonPassiveWheel(svgRef as { current: Element | null }, onWheel, wheelEnabled)

  // Clean up a pending wheel-idle timer on unmount so a settle event
  // does not fire into a torn-down surface.
  useEffect(() => {
    return () => {
      if (wheelIdleRef.current !== null) clearTimeout(wheelIdleRef.current)
    }
  }, [])

  const id = typeof v.id === 'string' ? v.id : undefined

  // Surface-level pointer/hover props. When the host owns pan/zoom it
  // consumes the surface-level pointer for panning, so the plugin's own
  // surface-level pointer handlers are NOT wired (child shapes still
  // fire their own handlers normally).
  const pointerProps = hostPanZoom
    ? buildPanHandlers()
    : pointerListenerProps(ctx, v, id, 'svg')

  function buildPanHandlers() {
    return {
      onPointerDown: (e: ReactPointerEvent) => {
        // Only pan when the gesture starts on the svg background, not on
        // a child shape that owns its own drag.
        if (e.target !== e.currentTarget) return
        const pz = pzRef.current
        dragRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startMinX: pz.minX,
          startMinY: pz.minY,
        }
        try {
          ;(e.currentTarget as Element & {
            setPointerCapture?: (id: number) => void
          }).setPointerCapture?.(e.pointerId)
        } catch {
          // best-effort capture
        }
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        const el = svgRef.current
        const pz = pzRef.current
        const clientW = el?.clientWidth || width
        const clientH = el?.clientHeight || height
        const userPerPxX = clientW !== 0 ? pz.w / clientW : 1
        const userPerPxY = clientH !== 0 ? pz.h / clientH : 1
        pz.minX = drag.startMinX - (e.clientX - drag.startClientX) * userPerPxX
        pz.minY = drag.startMinY - (e.clientY - drag.startClientY) * userPerPxY
        applyViewBox()
      },
      onPointerUp: (e: ReactPointerEvent) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        dragRef.current = null
        try {
          ;(e.currentTarget as Element & {
            releasePointerCapture?: (id: number) => void
          }).releasePointerCapture?.(e.pointerId)
        } catch {
          // best-effort
        }
        // ONE settle event at the end of the pan gesture.
        emitTransform()
      },
    }
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={initialViewBox}
      role="img"
      xmlns="http://www.w3.org/2000/svg"
      style={hostPanZoom ? ({ touchAction: 'none' } satisfies CSSProperties) : undefined}
      {...pointerProps}
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
    // v1.3 (L4) — tag edge endpoints with the node ids they follow so
    // the position-patch fast path can move them without a re-render.
    const sourceId = typeof c.sourceId === 'string' ? c.sourceId : undefined
    const targetId = typeof c.targetId === 'string' ? c.targetId : undefined
    return (
      <line
        key={key}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        {...(sourceId !== undefined ? { [EDGE_SOURCE_ATTR]: sourceId } : {})}
        {...(targetId !== undefined ? { [EDGE_TARGET_ATTR]: targetId } : {})}
      />
    )
  }

  if (tag === 'circle') {
    const c = child as Extract<SvgChild, { tag: 'circle' }>
    const cx = coerceFinite(c.cx)
    const cy = coerceFinite(c.cy)
    const r = coerceFinite(c.r)
    if (cx === null || cy === null || r === null) return null
    const fill = safeColor(c.fill) ?? 'currentColor'
    const stroke = safeColor(c.stroke) ?? 'none'
    const id = typeof c.id === 'string' ? c.id : undefined
    const pointerProps = pointerListenerProps(ctx, c, id, 'svg')
    const interactive =
      c.onClick !== undefined ||
      c.onPointerDown !== undefined ||
      c.onPointerMove !== undefined ||
      c.onPointerUp !== undefined
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={stroke}
        // v1.3 (L4) — addressable by node id for the position-patch path.
        {...(id !== undefined ? { [NODE_ID_ATTR]: id } : {})}
        onClick={c.onClick ? () => dispatchOrDrop(ctx, c.onClick) : undefined}
        {...pointerProps}
        style={interactive ? ({ cursor: 'pointer' } satisfies CSSProperties) : undefined}
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
    const id = typeof c.id === 'string' ? c.id : undefined
    const pointerProps = pointerListenerProps(ctx, c, id, 'svg')
    const interactive =
      c.onClick !== undefined ||
      c.onPointerDown !== undefined ||
      c.onPointerMove !== undefined ||
      c.onPointerUp !== undefined
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
        {...pointerProps}
        style={interactive ? ({ cursor: 'pointer' } satisfies CSSProperties) : undefined}
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
  // A box with an onWheel handler needs a non-passive wheel listener
  // (preventDefault), which requires a ref + effect — so it renders as a
  // component. A box with no wheel handler keeps the plain v1.2/L1 path.
  if (v.onWheel !== undefined) {
    return <PluginBox v={v} ctx={ctx} key={v.id ?? undefined} />
  }
  const childCtx: RenderContext = { onEvent: ctx.onEvent, depth: ctx.depth + 1 }
  const gap = v.gap !== undefined && v.gap in GAP_CLASSES ? GAP_CLASSES[v.gap] : 'gap-2'
  const id = typeof v.id === 'string' ? v.id : undefined
  const pointerProps = pointerListenerProps(ctx, v, id, 'box')
  return (
    <div className={`flex flex-col ${gap}`} {...pointerProps}>
      {v.children.map((child, idx) => {
        const rendered = renderWithContext(child, childCtx)
        if (rendered === null) return null
        return <div key={idx}>{rendered}</div>
      })}
    </div>
  )
}

/** v1.3 (L2) — box surface with a wheel handler. Same render as the
 *  plain box, plus a non-passive wheel listener that stops page scroll
 *  and dispatches the coalesced, `interaction.wheel`-gated event. */
function PluginBox({ v, ctx }: { v: VNodeBox; ctx: RenderContext }): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const childCtx: RenderContext = { onEvent: ctx.onEvent, depth: ctx.depth + 1 }
  const gap = v.gap !== undefined && v.gap in GAP_CLASSES ? GAP_CLASSES[v.gap] : 'gap-2'
  const id = typeof v.id === 'string' ? v.id : undefined
  const pointerProps = pointerListenerProps(ctx, v, id, 'box')

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    dispatchWheel(ctx, boxRef.current as unknown as Element, v.onWheel, e, { coordKind: 'box' })
  }
  useNonPassiveWheel(boxRef as { current: Element | null }, onWheel, true)

  return (
    <div ref={boxRef} className={`flex flex-col ${gap}`} {...pointerProps}>
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
