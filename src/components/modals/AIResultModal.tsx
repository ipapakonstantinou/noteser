'use client'

import { useEffect, useRef, useState } from 'react'
import { Modal, Button } from '@/components/ui'
import { ClipboardDocumentIcon, ArrowDownTrayIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore } from '@/stores'

interface AIResultData {
  // Which action ran (used for the modal title + display mode).
  actionId: string
  actionLabel: string
  // 'output' is a single-pane preview; 'compare' shows original vs result.
  display: 'output' | 'compare'
  // The note this acted on.
  noteId: string
  // Original content (used for the 'compare' diff pane).
  originalContent: string
  // The AI's response text.
  resultText: string
}

// Modal that displays the AI's output and lets the user apply it.
// Shared across every action — `display` determines the layout.
export const AIResultModal = () => {
  const { modal, closeModal } = useUIStore()
  const updateNote = useNoteStore(s => s.updateNote)
  const getNoteById = useNoteStore(s => s.getNoteById)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOpen = modal.type === 'ai-result'
  const data = modal.data as AIResultData | undefined

  // Reset copied-state when the modal opens/closes so the next visit
  // doesn't start with the "Copied!" label.
  useEffect(() => {
    if (!isOpen) {
      setCopied(false)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
    }
  }, [isOpen])

  if (!isOpen || !data) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.resultText)
      setCopied(true)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Some browsers / contexts disallow clipboard writes; fail silent.
    }
  }

  // Append the result to the note's existing body with a separating
  // blank line. Used for 'output'-mode actions (summary, tasks, tags)
  // where the result is additive.
  const handleAppend = () => {
    const note = getNoteById(data.noteId)
    if (!note) return
    const base = (note.content ?? '').replace(/\s+$/u, '')
    const next = base ? `${base}\n\n${data.resultText.trim()}\n` : `${data.resultText.trim()}\n`
    updateNote(data.noteId, { content: next })
    closeModal()
  }

  // Replace the entire note body with the result. Used for 'compare'
  // actions (rewrite, translate) where the result is a transformed
  // version of the original.
  const handleReplace = () => {
    if (!confirm('Replace the note content with the AI result? This can be undone via Ctrl+Z in the editor after the change applies.')) return
    updateNote(data.noteId, { content: data.resultText })
    closeModal()
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size={data.display === 'compare' ? 'xl' : 'lg'}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-obsidianText">{data.actionLabel}</h3>
          <Button variant="ghost" onClick={closeModal} className="text-obsidianSecondaryText text-xs">
            Close
          </Button>
        </div>

        {data.display === 'compare' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText mb-1">Original</div>
              <pre className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded p-3 max-h-[60dvh] overflow-auto whitespace-pre-wrap font-sans">
                {data.originalContent || <span className="italic text-obsidianSecondaryText">(empty)</span>}
              </pre>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-obsidianAccentPurple mb-1">AI result</div>
              <pre
                className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianAccentPurple/40 rounded p-3 max-h-[60dvh] overflow-auto whitespace-pre-wrap font-sans"
                data-testid="ai-result-text"
              >
                {data.resultText}
              </pre>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText mb-1">AI result</div>
            <pre
              className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded p-3 max-h-[60dvh] overflow-auto whitespace-pre-wrap font-sans"
              data-testid="ai-result-text"
            >
              {data.resultText}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-obsidianBorder">
          <Button variant="secondary" onClick={handleCopy} data-testid="ai-copy-btn">
            <ClipboardDocumentIcon className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          {data.display === 'output' && (
            <Button variant="secondary" onClick={handleAppend} data-testid="ai-append-btn">
              <ArrowDownTrayIcon className="w-4 h-4" />
              Insert at end
            </Button>
          )}
          {data.display === 'compare' && (
            <Button variant="primary" onClick={handleReplace} data-testid="ai-replace-btn">
              <ArrowsRightLeftIcon className="w-4 h-4" />
              Replace note content
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default AIResultModal
