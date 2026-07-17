'use client'

import { useState } from 'react'
import { useUIStore, useNoteStore, useFolderStore, useTagStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import type { ExportOptions } from '@/types'

// `@/utils/export` pulls in jszip (~140kB) and file-saver. Both are
// only needed when the user actually clicks Export, so we dynamic-
// import the module inside the click handler. The modal itself
// remains in the main bundle — only the heavy zip/saver code splits.

export const ExportModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const selectedNoteId = useNoteStore(s => s.selectedNoteId)
  const getNoteById = useNoteStore(s => s.getNoteById)
  const getActiveNotes = useNoteStore(s => s.getActiveNotes)
  const folders = useFolderStore(s => s.folders)
  const getActiveFolders = useFolderStore(s => s.getActiveFolders)
  const tags = useTagStore(s => s.tags)

  const [options, setOptions] = useState<ExportOptions>({
    format: 'markdown',
    includeMetadata: true,
    includeTags: true
  })
  const [exportType, setExportType] = useState<'current' | 'all'>('all')
  const [isExporting, setIsExporting] = useState(false)

  const isOpen = modal.type === 'export'
  const currentNote = selectedNoteId ? getNoteById(selectedNoteId) : null

  const handleExport = async () => {
    setIsExporting(true)
    try {
      // Lazy-load — jszip + file-saver get split into their own chunk
      // and only load when the user actually clicks Export.
      const exp = await import('@/utils/export')
      if (exportType === 'current' && currentNote) {
        // Single-note path routes by format. The HTML and PDF cases
        // were previously silently downgrading to markdown — now each
        // has its own helper.
        if (options.format === 'json') {
          exp.exportNoteAsJSON(currentNote)
        } else if (options.format === 'html') {
          exp.exportNoteAsHTML(currentNote, options.includeTags)
        } else if (options.format === 'pdf') {
          exp.exportNoteAsPdf(currentNote)
        } else {
          exp.exportNoteAsMarkdown(currentNote, tags)
        }
      } else if (options.format === 'pdf') {
        // PDF all-notes path opens a print window rather than producing
        // a zip; bypass exportAllNotes.
        exp.exportAllNotesAsPdf(getActiveNotes(), options)
      } else {
        await exp.exportAllNotes(
          getActiveNotes(),
          getActiveFolders(),
          tags,
          options
        )
      }
      closeModal()
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Export Notes" size="md">
      <div className="space-y-4">
        {/* Export type */}
        <div>
          <label className="block text-sm font-medium text-obsidianText mb-2">
            What to export
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setExportType('all')}
              className={`flex-1 px-4 py-2 rounded border transition-colors ${
                exportType === 'all'
                  ? 'border-obsidianAccentPurple bg-obsidianAccentPurple/10 text-obsidianAccentPurple'
                  : 'border-obsidianBorder text-obsidianSecondaryText hover:border-obsidianHighlight'
              }`}
            >
              All Notes ({getActiveNotes().length})
            </button>
            <button
              onClick={() => setExportType('current')}
              disabled={!currentNote}
              className={`flex-1 px-4 py-2 rounded border transition-colors ${
                exportType === 'current'
                  ? 'border-obsidianAccentPurple bg-obsidianAccentPurple/10 text-obsidianAccentPurple'
                  : 'border-obsidianBorder text-obsidianSecondaryText hover:border-obsidianHighlight disabled:opacity-50'
              }`}
            >
              Current Note
            </button>
          </div>
        </div>

        {/* Format */}
        <div>
          <label className="block text-sm font-medium text-obsidianText mb-2">
            Format
          </label>
          <div className="flex gap-2">
            {(['markdown', 'json', 'html', 'pdf'] as const).map(format => (
              <button
                key={format}
                onClick={() => setOptions(prev => ({ ...prev, format }))}
                className={`flex-1 px-4 py-2 rounded border transition-colors ${
                  options.format === format
                    ? 'border-obsidianAccentPurple bg-obsidianAccentPurple/10 text-obsidianAccentPurple'
                    : 'border-obsidianBorder text-obsidianSecondaryText hover:border-obsidianHighlight'
                }`}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          {options.format === 'pdf' && (
            <p className="mt-2 text-xs text-obsidianSecondaryText">
              Opens the system print dialog — choose &ldquo;Save as PDF&rdquo; as the destination.
            </p>
          )}
        </div>

        {/* Options */}
        {exportType === 'all' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeMetadata}
                onChange={e => setOptions(prev => ({ ...prev, includeMetadata: e.target.checked }))}
                className="w-4 h-4 rounded-sm border-obsidianBorder bg-obsidianDarkGray text-obsidianAccentPurple focus:ring-obsidianAccentPurple"
              />
              <span className="text-sm text-obsidianText">Include metadata (dates, IDs)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeTags}
                onChange={e => setOptions(prev => ({ ...prev, includeTags: e.target.checked }))}
                className="w-4 h-4 rounded-sm border-obsidianBorder bg-obsidianDarkGray text-obsidianAccentPurple focus:ring-obsidianAccentPurple"
              />
              <span className="text-sm text-obsidianText">Include tags</span>
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t border-obsidianBorder">
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            isLoading={isExporting}
          >
            Export
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default ExportModal
