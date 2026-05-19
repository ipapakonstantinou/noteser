'use client'

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { useUIStore } from '@/stores'

// Settings sub-section: exposes the "Export notes" action that opens the
// existing ExportModal. The previous entry point was a sidebar-footer button
// that used the wrong icon (a Cog) — it now lives here alongside the other
// vault-wide actions.
export const ExportSection = () => {
  const openModal = useUIStore(s => s.openModal)

  return (
    <div className="space-y-3">
      <div className="text-xs text-obsidianSecondaryText leading-relaxed">
        Download all notes as markdown, JSON, or HTML. Choose the format in the
        next dialog.
      </div>

      <div className="flex items-center">
        <button
          onClick={() => openModal({ type: 'export' })}
          className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-obsidianAccentPurple text-white hover:opacity-90"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
          Export notes
        </button>
      </div>
    </div>
  )
}

export default ExportSection
