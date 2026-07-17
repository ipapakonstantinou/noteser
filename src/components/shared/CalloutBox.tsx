import { createElement, type ReactNode } from 'react'
import { CALLOUT_ICON_SHAPES, CALLOUT_LABELS, CALLOUT_STYLES, type CalloutType } from '@/utils/callouts'

// CALLOUT_ICON_SHAPES uses literal DOM attribute names (kebab-case) so the
// CodeMirror widget's setAttribute() calls in markdownLivePreview.ts can use
// them as-is; React's JSX runtime, unlike setAttribute, requires camelCase
// for a handful of known SVG props (stroke-width, stroke-linecap, …) and
// warns otherwise — convert just for this consumer.
function toReactSvgProps(attrs: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(attrs)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v
  return out
}

export function CalloutIcon({ type, className }: { type: CalloutType; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className={className} aria-hidden="true">
      {CALLOUT_ICON_SHAPES[type].map((shape, i) => createElement(shape.tag, { key: i, ...toReactSvgProps(shape.attrs) }))}
    </svg>
  )
}

export function CalloutBox({
  type,
  className,
  children,
}: {
  type: CalloutType
  className?: string
  children?: ReactNode
}) {
  const style = CALLOUT_STYLES[type]
  return (
    <div
      className={[className, 'callout', 'border-l-4 rounded-r px-3 py-2 my-3', style.border, style.bg]
        .filter(Boolean).join(' ')}
      data-callout-type={type}
    >
      <div className={['flex items-center gap-1.5 font-semibold text-sm mb-1', style.text].join(' ')}>
        <CalloutIcon type={type} className={style.text} />
        {CALLOUT_LABELS[type]}
      </div>
      <div className="*:first:mt-0 *:last:mb-0">{children}</div>
    </div>
  )
}
