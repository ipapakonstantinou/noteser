'use client'

import { useState } from 'react'
import { useUIStore, useNoteStore, useFolderStore, useTagStore } from '@/stores'
import { Modal, Button } from '@/components/ui'
import { exportAllNotes, exportNoteAsMarkdown, exportNoteAsJSON } from '@/utils/export'
import type { ExportOptions } from '@/types'

export const ExportModal = () => {
  const { modal, closeModal } = useUIStore()
  const { notes, selectedNoteId, getNoteById, getActiveNotes } = useNoteStore()
  const { folders, getActiveFolders } = useFolderStore()
  const { tags } = useTagStore()

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
      if (exportType === 'current' && currentNote) {
        if (options.format === 'json') {
          exportNoteAsJSON(currentNote)
        } else {
          exportNoteAsMarkdown(currentNote, tags)
        }
      } else {
        await exportAllNotes(
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
            {(['markdown', 'json', 'html'] as const).map(format => (
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
        </div>

        {/* Options */}
        {exportType === 'all' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeMetadata}
                onChange={e => setOptions(prev => ({ ...prev, includeMetadata: e.target.checked }))}
                className="w-4 h-4 rounded border-obsidianBorder bg-obsidianDarkGray text-obsidianAccentPurple focus:ring-obsidianAccentPurple"
              />
              <span className="text-sm text-obsidianText">Include metadata (dates, IDs)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeTags}
                onChange={e => setOptions(prev => ({ ...prev, includeTags: e.target.checked }))}
                className="w-4 h-4 rounded border-obsidianBorder bg-obsidianDarkGray text-obsidianAccentPurple focus:ring-obsidianAccentPurple"
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
