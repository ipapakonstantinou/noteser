'use client'

import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { useUIStore } from '@/stores'

// Visible left-edge handle that opens the mobile sidebar drawer.
//
// Why this exists: the drawer also opens via an edge-swipe (right-swipe
// from the left 24px — see the useEffect in page.tsx), but iOS WebKit
// (Chrome + Safari) claim that outermost-edge swipe for browser
// back-navigation, so a web app cannot reliably win that gesture. This
// handle is the dependable, discoverable affordance; the edge-swipe
// stays as a bonus where the OS lets it through.
//
// Rendered ONLY when the drawer is closed (page.tsx gates on
// `mobileLayout && !drawerOpen`). When the drawer is open the existing
// backdrop handles closing, so this is hidden.
//
// Visual: a thin rounded pill pinned to the left edge, vertically
// centred, with a faint chevron-right hinting "tap to reveal". The
// visible pill is narrow (~7px) but the tap target is a full 44px-wide
// button so it's comfortable on touch. Safe-area inset on the left
// keeps it clear of any rounded-display / gesture zone.

export const DrawerHandle = () => {
  const toggleSidebar = useUIStore(s => s.toggleSidebar)

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Open sidebar"
      title="Open sidebar"
      data-testid="mobile-drawer-handle"
      className="fixed left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-start w-11 h-12 pl-[max(2px,env(safe-area-inset-left))] group focus:outline-hidden"
    >
      {/* The visible pill. The wide button above is the tap target; this
          slim bar is the only thing the user sees. */}
      <span
        className="flex items-center justify-center w-[7px] h-12 rounded-r-md bg-obsidianAccent text-obsidianSecondaryText border-y border-r border-obsidianBorder shadow-obsidian transition-colors group-hover:bg-obsidianHighlight group-hover:text-obsidianText group-active:bg-obsidianHighlight"
      >
        <ChevronRightIcon className="w-3 h-3 -ml-px" />
      </span>
    </button>
  )
}

export default DrawerHandle
