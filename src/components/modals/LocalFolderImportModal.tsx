'use client'

import { useEffect, useState } from 'react'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  FolderOpenIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useNoteStore, useLocalFolderStore } from '@/stores'
import { importFolderNotes } from '@/utils/localFolderSync'
import { v4 as uuidv4 } from 'uuid'

// Confirmation modal for "Sync from folder" — the destructive
// direction. Reads every .md file in the picked folder, previews how
// many would be imported / overwritten / left alone, then on confirm
// applies the result to the noteStore.
//
// Open via:
//   useUIStore.openModal({ type: 'local-folder-import' })

interface PreviewRow {
  path: string
  matchedNoteId: string | null
  // True when the on-disk content differs from the local note's
  // current content. When matched-but-equal, the row is "unchanged".
  changed: boolean
}

export const LocalFolderImportModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const isOpen = modal.type === 'local-folder-import'

  const handle = useLocalFolderStore(s => s.handle)
  const setBusy = useLocalFolderStore(s => s.setBusy)
  const recordSync = useLocalFolderStore(s => s.recordSync)
  const setLastError = useLocalFolderStore(s => s.setLastError)

  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!isOpen || !handle) return
    setRows(null)
    setScanning(true)
    setScanError(null)
    setApplying(false)
    setDone(false)
    void (async () => {
      try {
        const notes = useNoteStore.getState().notes
        const imported = await importFolderNotes(handle, notes)
        // Build the preview rows synchronously from `imported` —
        // matched rows compare content for the changed-vs-unchanged bit.
        const byId = new Map(notes.map(n => [n.id, n]))
        const preview: PreviewRow[] = imported.map(i => ({
          path: i.path,
          matchedNoteId: i.matchedNoteId,
          changed: i.matchedNoteId
            ? byId.get(i.matchedNoteId)?.content !== i.content
            : true,
        }))
        setRows(preview)
      } catch (err) {
        setScanError(err instanceof Error ? err.message : 'Scan failed')
      } finally {
        setScanning(false)
      }
    })()
  }, [isOpen, handle])

  if (!isOpen) return null

  const handleApply = async () => {
    if (!handle) return
    setApplying(true)
    setLastError(null)
    setBusy(true)
    try {
      const existing = useNoteStore.getState().notes
      const byId = new Map(existing.map(n => [n.id, n]))
      const imported = await importFolderNotes(handle, existing)
      const now = Date.now()
      const next: typeof existing = [...existing]
      const seenIds = new Set<string>()
      for (const im of imported) {
        if (im.matchedNoteId) {
          // Replace content + title in place.
          const idx = next.findIndex(n => n.id === im.matchedNoteId)
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              title: im.title,
              content: im.content,
              updatedAt: now,
              isDeleted: false,
              deletedAt: null,
            }
            seenIds.add(im.matchedNoteId)
          }
        } else {
          // Fresh import — synthesize a new note.
          const id = uuidv4()
          next.push({
            id,
            title: im.title,
            content: im.content,
            folderId: null,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            deletedAt: null,
            isPinned: false,
            templateId: null,
            gitPath: im.path,
            gitLastPushedSha: null,
          })
          seenIds.add(id)
        }
      }
      useNoteStore.setState({ notes: next })
      recordSync()
      setDone(true)
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setApplying(false)
      setBusy(false)
    }
  }

  // Layout — three states: scanning, preview, done.
  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Sync from folder" size="md">
      {scanning && (
        <div className="text-sm text-obsidianSecondaryText" data-testid="local-folder-scanning">
          <FolderOpenIcon className="w-5 h-5 inline-block mr-2 text-obsidianAccentPurple" />
          Scanning folder…
        </div>
      )}
      {scanError && (
        <div className="flex items-start gap-2 p-3 rounded-sm bg-red-900/20 border border-red-900/40 text-xs text-red-300">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{scanError}</span>
        </div>
      )}
      {!scanning && !scanError && rows && !done && (
        <div className="space-y-4 text-sm">
          <p className="text-obsidianSecondaryText">
            About to import <span className="text-obsidianText font-medium">{rows.length}</span>{' '}
            file(s) from the folder. Counts:
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <SummaryRow label="New" value={rows.filter(r => !r.matchedNoteId).length} />
            <SummaryRow label="Updated (content changed)" value={rows.filter(r => r.matchedNoteId && r.changed).length} />
            <SummaryRow label="Unchanged" value={rows.filter(r => r.matchedNoteId && !r.changed).length} />
          </dl>
          <div className="flex items-start gap-2 p-3 rounded-sm bg-amber-900/20 border border-amber-900/40 text-amber-200 text-xs">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Importing overwrites the matching local notes&apos; content with whatever is in the
              folder. Local notes that aren&apos;t in the folder are left alone.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-obsidianBorder">
            <Button variant="ghost" onClick={closeModal} disabled={applying}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={applying || rows.length === 0}
              data-testid="local-folder-import-apply"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              {applying ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      )}
      {done && (
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 p-3 rounded-sm bg-emerald-900/20 border border-emerald-900/40 text-emerald-200 text-xs">
            <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <span>Imported. The vault now matches the folder for every file that was present.</span>
          </div>
          <div className="flex justify-end pt-2 border-t border-obsidianBorder">
            <Button variant="primary" onClick={closeModal}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

const SummaryRow = ({ label, value }: { label: string; value: number }) => (
  <>
    <dt className="text-obsidianSecondaryText">{label}</dt>
    <dd className="text-obsidianText font-mono">{value}</dd>
  </>
)

export default LocalFolderImportModal
