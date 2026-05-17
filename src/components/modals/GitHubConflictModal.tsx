'use client'

import { useMemo, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore } from '@/stores'
import { applyConflictResolution } from '@/utils/syncApply'
import type { PullClassification } from '@/utils/githubSync'

// Module-level signal so the sidebar can re-run sync once the user resolves
// conflicts here. Avoids prop-drilling and keeps the sync state owned by one
// place (the sidebar's `useGitHubSync`).
export const SYNC_REQUEST_EVENT = 'noteser:sync-request'

// Just the two kinds we surface to the user.
type ConflictItem = Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>

export const GitHubConflictModal = () => {
  const { modal, closeModal } = useUIStore()

  const conflicts = useMemo<ConflictItem[]>(() => {
    const raw = modal.data?.conflicts
    return Array.isArray(raw) ? (raw as ConflictItem[]) : []
  }, [modal.data])

  // path → 'local' | 'remote' | undefined
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({})
  // path → expanded?
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const isOpen = modal.type === 'github-conflicts'
  const allResolved = conflicts.length > 0 && conflicts.every(c => choices[keyFor(c)] != null)

  const setChoice = (c: ConflictItem, choice: 'local' | 'remote') => {
    setChoices(prev => ({ ...prev, [keyFor(c)]: choice }))
  }
  const toggleExpanded = (c: ConflictItem) => {
    const k = keyFor(c)
    setExpanded(prev => ({ ...prev, [k]: !prev[k] }))
  }

  const applyAll = () => {
    for (const c of conflicts) {
      const choice = choices[keyFor(c)]
      if (!choice) continue
      applyConflictResolution(c, choice)
    }
    closeModal()
    // Ask the sidebar to re-run sync so resolved local-wins get pushed and
    // remote-wins are flushed to the store. The user shouldn't have to click
    // Sync again.
    window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={`Resolve ${conflicts.length} sync conflict${conflicts.length === 1 ? '' : 's'}`} size="xl">
      <div className="space-y-3">
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded text-sm text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            These notes were edited <strong>both locally and on GitHub</strong> since the last sync.
            Pick which version to keep for each. After applying, click Sync again to push the resolved
            state to the repo.
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-2">
          {conflicts.map(c => {
            const k = keyFor(c)
            const choice = choices[k]
            const isExpanded = expanded[k]
            return (
              <div
                key={k}
                className={`border rounded ${
                  choice ? 'border-obsidianAccentPurple/40 bg-obsidianAccentPurple/5' : 'border-obsidianBorder'
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={() => toggleExpanded(c)}
                    className="p-1 text-obsidianSecondaryText hover:text-obsidianText"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className="w-4 h-4" />
                    ) : (
                      <ChevronRightIcon className="w-4 h-4" />
                    )}
                  </button>
                  <code className="flex-1 truncate text-sm text-obsidianText">{c.path}</code>
                  {c.kind === 'conflictDeleted' && (
                    <span className="text-xs text-amber-400">remote deleted</span>
                  )}
                  <button
                    onClick={() => setChoice(c, 'local')}
                    className={`px-2 py-1 rounded text-xs ${
                      choice === 'local'
                        ? 'bg-obsidianAccentPurple text-white'
                        : 'bg-obsidianDarkGray text-obsidianText hover:bg-obsidianHighlight'
                    }`}
                  >
                    Keep local
                  </button>
                  <button
                    onClick={() => setChoice(c, 'remote')}
                    disabled={c.kind === 'conflictDeleted'}
                    className={`px-2 py-1 rounded text-xs ${
                      choice === 'remote'
                        ? 'bg-obsidianAccentPurple text-white'
                        : 'bg-obsidianDarkGray text-obsidianText hover:bg-obsidianHighlight disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    title={c.kind === 'conflictDeleted' ? 'Remote has been deleted — pick Local to keep, or Local to discard' : undefined}
                  >
                    {c.kind === 'conflictDeleted' ? 'Accept delete' : 'Keep remote'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-obsidianBorder px-3 py-2 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-obsidianSecondaryText mb-1">Local</div>
                      <pre className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded p-2 whitespace-pre-wrap max-h-60 overflow-auto">
                        {c.localContent}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs text-obsidianSecondaryText mb-1">
                        {c.kind === 'conflictDeleted' ? 'Remote (deleted)' : 'Remote'}
                      </div>
                      {c.kind === 'conflict' ? (
                        <pre className="text-xs text-obsidianText bg-obsidianDarkGray border border-obsidianBorder rounded p-2 whitespace-pre-wrap max-h-60 overflow-auto">
                          {c.remoteContent}
                        </pre>
                      ) : (
                        <div className="text-xs italic text-obsidianSecondaryText bg-obsidianDarkGray border border-obsidianBorder rounded p-2">
                          The remote file has been deleted.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-obsidianBorder">
          <Button variant="ghost" onClick={closeModal}>Cancel</Button>
          <Button variant="primary" onClick={applyAll} disabled={!allResolved}>
            Apply {Object.keys(choices).length}/{conflicts.length}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function keyFor(c: ConflictItem): string {
  return c.path
}

export default GitHubConflictModal
