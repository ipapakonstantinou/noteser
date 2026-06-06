'use client'

import type { ReactNode } from 'react'

// Shared heading used by every Settings panel. Lives next to the other
// settings primitives so a panel only needs one import.
export function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-base font-medium text-obsidianText border-b border-obsidianBorder pb-2 mb-3">
      {children}
    </h3>
  )
}
