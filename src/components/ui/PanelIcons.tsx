// Obsidian-style sidebar-collapse icons. A small rectangle with a thin
// vertical bar on the near edge that visually says "this panel slides
// to that side". Pixel-perfect inline SVGs — zero deps, matches the
// Heroicons API shape so callers can drop them in alongside any other
// icon from `@heroicons/react/24/outline`.
//
// `PanelLeftIcon` — the bar sits on the LEFT (the left sidebar
// collapses leftward). Used in Sidebar.tsx for the toggle button.
//
// `PanelRightIcon` — mirrored, for the right sidebar's toggle (added
// in a later branch). Authored here proactively so the right side has
// a symmetric icon when it lands.
//
// Stroke width + 24×24 viewBox mirror Heroicons v2 outline icons; pass
// className like any other Heroicons component (`className="w-4 h-4"`
// is the common call site).

import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string
}

export const PanelLeftIcon = ({ className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <line x1="9" y1="4.5" x2="9" y2="19.5" />
  </svg>
)

export const PanelRightIcon = ({ className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <line x1="15" y1="4.5" x2="15" y2="19.5" />
  </svg>
)
