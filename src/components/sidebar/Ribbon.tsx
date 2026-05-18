'use client'

import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useUIStore } from '@/stores'

// Obsidian-style far-left ribbon. Always visible (independent of the
// folder/notes sidebar's collapsed state).
export const Ribbon = () => {
  const openSearch = useUIStore(s => s.openSearch)

  return (
    <div className="h-full w-[44px] flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-r border-obsidianBorder">
      <button
        onClick={openSearch}
        title="Search (Ctrl+K)"
        className="p-2 rounded text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors"
      >
        <MagnifyingGlassIcon className="w-5 h-5" />
      </button>
    </div>
  )
}

export default Ribbon
