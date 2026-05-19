'use client'

import { useEffect, useState, useCallback } from 'react'
import { useNoteStore, useSettingsStore } from '@/stores'
import {
  normalizeAttachmentDir,
  listAttachmentMeta,
  deleteAttachment,
  type AttachmentMeta,
} from '@/utils/attachments'
import { findOrphanAttachments } from '@/utils/attachmentRefs'
import { SettingsTextInput } from './settings'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Settings sub-section: surfaces the attachment folder location, basic stats
// (count + total size), and an orphan-cleanup action. The per-file list was
// removed per user request — folder path + stats is what's useful here.
export const AttachmentsSection = () => {
  const notes = useNoteStore(s => s.notes)
  const attachmentsFolderSetting = useSettingsStore(s => s.attachmentsFolder)
  const setAttachmentsFolder = useSettingsStore(s => s.setAttachmentsFolder)
  const [meta, setMeta] = useState<AttachmentMeta[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setMeta(await listAttachmentMeta())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const total = meta?.length ?? 0
  const totalBytes = (meta ?? []).reduce((n, m) => n + m.size, 0)
  const orphans = meta ? findOrphanAttachments(meta.map(m => m.path), notes) : []

  const handleCleanupOrphans = async () => {
    if (orphans.length === 0) return
    if (!confirm(`Delete ${orphans.length} orphan attachment${orphans.length === 1 ? '' : 's'} not referenced by any note?`)) return
    setBusy(true)
    try {
      for (const path of orphans) await deleteAttachment(path)
      await refresh()
    } finally { setBusy(false) }
  }

  const handleCommit = (normalised: string) => {
    if (normalised !== attachmentsFolderSetting) setAttachmentsFolder(normalised)
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-obsidianSecondaryText leading-relaxed">
        New attachments land under the folder below and appear in the sidebar
        as a regular folder. Existing files keep their original path —
        switching the folder doesn&apos;t move or rename anything.
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-obsidianSecondaryText">Folder</span>
        <SettingsTextInput
          value={attachmentsFolderSetting}
          onCommit={handleCommit}
          normalize={normalizeAttachmentDir}
          placeholder="attachments"
          mono
        />
        <span className="text-obsidianSecondaryText">/</span>
      </div>
      <div className="text-[11px] text-obsidianSecondaryText -mt-1">
        Affects new attachments only. Existing files keep their original path; both old and new are still recognised.
      </div>

      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="text-obsidianText">
          {loading ? 'Loading…' : <>
            <span className="font-medium">{total}</span> file{total === 1 ? '' : 's'}
            <span className="text-obsidianSecondaryText ml-2">· {formatBytes(totalBytes)}</span>
            {orphans.length > 0 && (
              <span className="ml-2 text-obsidianAccentPurple">
                · {orphans.length} orphan{orphans.length === 1 ? '' : 's'}
              </span>
            )}
          </>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={busy || loading}
            className="text-xs text-obsidianSecondaryText hover:text-obsidianText disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={handleCleanupOrphans}
            disabled={busy || loading || orphans.length === 0}
            className="text-xs px-2 py-1 rounded border border-obsidianBorder text-obsidianText hover:bg-obsidianDarkGray disabled:opacity-50 disabled:hover:bg-transparent"
          >
            Clean up orphans
          </button>
        </div>
      </div>
    </div>
  )
}

export default AttachmentsSection
