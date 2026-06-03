'use client'

// Curated virtual-DOM renderer for plugin output.
//
// Plugins emit a small set of VNode shapes via ctx.setPanelContent or
// ctx.renderCodeBlock; the host maps each shape to a real React tree
// here. This is the v1 component surface — keep it intentionally
// narrow. Anything richer in v2 lands as a new tag with its own
// security review.
//
// Why curated and not raw HTML / React: plugins run in a Worker, the
// Worker has no DOM, so the only thing it CAN emit is data. Mapping
// data to React inside this single module means the worker cannot
// inject script, style, or arbitrary attributes. One audit surface.
//
// All shapes carry `tag` as discriminator.

import type { ReactNode } from 'react'

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

export type VNode = VNodeText | VNodeCallout

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

/**
 * Render a single VNode received from a plugin. Returns null when the
 * shape is unrecognised — the caller decides whether to show a
 * fallback (JSON dump for debug, an error pane in prod).
 */
export function renderPluginVNode(node: unknown): ReactNode | null {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || !('tag' in node)) return null

  const tag = (node as { tag: unknown }).tag

  if (tag === 'text') {
    const v = node as VNodeText
    if (typeof v.value !== 'string') return null
    return <span>{v.value}</span>
  }

  if (tag === 'callout') {
    const v = node as VNodeCallout
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

  return null
}

/**
 * Render-or-fallback. Unrecognised shapes show a JSON dump in dev so
 * plugin authors can spot a typo, and the same dump in prod (we do
 * not strip it — the surface area is too small to bother gating).
 */
export function PluginNode({ node }: { node: unknown }) {
  const rendered = renderPluginVNode(node)
  if (rendered !== null) return <>{rendered}</>
  return (
    <pre className="text-xs font-mono text-obsidianSecondaryText whitespace-pre-wrap">
      {JSON.stringify(node, null, 2)}
    </pre>
  )
}
