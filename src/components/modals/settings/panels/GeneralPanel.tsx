'use client'

import { useMemo } from 'react'
import { useUIStore, useSettingsStore, useNoteStore, useFolderStore } from '@/stores'
import type { FolderSortMode } from '@/stores'
import type { TrashMode } from '@/stores/settingsStore'
import { sanitizeFilename } from '@/utils/sanitizeFilename'
import {
  Field,
  SettingsSelect,
  SettingsCheckbox,
  SettingsTextInput,
} from '../index'
import { PanelHeading } from '../PanelHeading'

export function GeneralPanel() {
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const trashMode = useSettingsStore(s => s.trashMode)
  const trashFolderName = useSettingsStore(s => s.trashFolderName)
  const confirmBulkDelete = useSettingsStore(s => s.confirmBulkDelete)
  const confirmBeforeTrash = useSettingsStore(s => s.confirmBeforeTrash)
  const shareDefaultExpiryDays = useSettingsStore(s => s.shareDefaultExpiryDays)
  const shareDefaultBurn = useSettingsStore(s => s.shareDefaultBurn)
  const startupNoteId = useSettingsStore(s => s.startupNoteId)
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
  const setTrashMode = useSettingsStore(s => s.setTrashMode)
  const setTrashFolderName = useSettingsStore(s => s.setTrashFolderName)
  const setConfirmBulkDelete = useSettingsStore(s => s.setConfirmBulkDelete)
  const setConfirmBeforeTrash = useSettingsStore(s => s.setConfirmBeforeTrash)
  const setShareDefaultExpiryDays = useSettingsStore(s => s.setShareDefaultExpiryDays)
  const setShareDefaultBurn = useSettingsStore(s => s.setShareDefaultBurn)
  const setStartupNoteId = useSettingsStore(s => s.setStartupNoteId)

  // Note picker options: every non-deleted note labeled by FULL PATH
  // so two notes with the same title in different folders stay
  // distinguishable. Sorted by path, capped at 500 to keep the
  // dropdown usable on huge vaults.
  const notesForPicker = useNoteStore(s => s.notes)
  const foldersForPicker = useFolderStore(s => s.folders)
  const startupOptions = useMemo(() => {
    const folderById = new Map(foldersForPicker.map(f => [f.id, f] as const))
    const pathOf = (folderId: string | null): string => {
      const parts: string[] = []
      let cur: string | null = folderId
      while (cur) {
        const f = folderById.get(cur)
        if (!f) break
        parts.unshift(f.name)
        cur = f.parentId
      }
      return parts.join('/')
    }
    const labeled = notesForPicker
      .filter(n => !n.isDeleted)
      .map(n => {
        const folderPath = pathOf(n.folderId ?? null)
        const title = n.title || 'Untitled'
        const label = folderPath ? `${folderPath}/${title}` : title
        return { id: n.id, label }
      })
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .slice(0, 500)
    return [
      { value: '', label: 'Welcome view (default)' },
      ...labeled.map(n => ({ value: n.id, label: n.label })),
    ]
  }, [notesForPicker, foldersForPicker])

  return (
    <div className="space-y-4">
      <PanelHeading>General</PanelHeading>
      <Field
        label="Open on launch"
        description="Which note opens automatically when Noteser starts. Leave on `Welcome view` to keep the current behaviour."
      >
        <SettingsSelect<string>
          value={startupNoteId ?? ''}
          onChange={(v) => setStartupNoteId(v === '' ? null : v)}
          options={startupOptions}
        />
      </Field>
      <Field
        label="Sort notes within folders"
        description="How notes are ordered in the sidebar. Manual = insertion order."
      >
        <SettingsSelect<FolderSortMode>
          value={folderSortMode}
          onChange={setFolderSortMode}
          options={[
            { value: 'alphabetical', label: 'Alphabetical (A → Z)' },
            { value: 'modified', label: 'Last modified (newest first)' },
            { value: 'created', label: 'Date created (newest first)' },
            { value: 'manual', label: 'Manual (insertion order)' },
          ]}
        />
      </Field>
      <Field
        label="Show hidden folders"
        description="Folders whose name starts with a dot (`.obsidian`, `.github`, …). Turn off to suppress them from the sidebar."
      >
        <SettingsCheckbox
          checked={showHiddenFolders}
          onChange={setShowHiddenFolders}
        />
      </Field>
      <Field
        label="Delete behaviour"
        description="What happens when you delete a note. Trash keeps it recoverable via the Trash view. No trash deletes immediately."
      >
        <SettingsSelect<TrashMode>
          value={trashMode}
          onChange={setTrashMode}
          options={[
            { value: 'trash', label: 'Move to trash (recoverable)' },
            { value: 'hardDelete', label: 'Delete immediately (no trash)' },
          ]}
        />
      </Field>
      <Field
        label="Trash folder"
        description="Display name for the trash row in the sidebar. Renaming is cosmetic — trashed notes stay trashed and recoverable across the rename. Defaults to `.trash`."
      >
        <SettingsTextInput
          value={trashFolderName}
          onCommit={setTrashFolderName}
          normalize={(raw) => sanitizeFilename(raw) || '.trash'}
          placeholder=".trash"
          mono
        />
      </Field>
      <Field
        label="Confirm before moving notes to trash"
        description="When off, deleting a note skips the confirmation and moves it straight to trash. Only applies in `Move to trash` mode — immediate-delete still confirms because it can't be undone."
      >
        <SettingsCheckbox
          checked={confirmBeforeTrash}
          onChange={setConfirmBeforeTrash}
        />
      </Field>
      <Field
        label="Confirm before bulk delete"
        description="Show a confirm dialog when deleting multiple notes via the sidebar's multi-select (Ctrl/Cmd+Click). Turn off if you trust your aim."
      >
        <SettingsCheckbox
          checked={confirmBulkDelete}
          onChange={setConfirmBulkDelete}
        />
      </Field>

      {/* Share defaults (shr2). Both fields piggy-back on the General
          panel because they're tiny — a dedicated "Sharing" category
          can graduate them later if more options accumulate. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Sharing
        </div>
        <Field
          label="Default expiry"
          description="Days until newly-generated /share links stop rendering. 0 = no expiry. Recipient browser enforces, so it's an honor-system check, not a server-revoke."
        >
          <div className="flex items-center gap-2">
            <SettingsTextInput
              value={String(shareDefaultExpiryDays)}
              onCommit={(raw) => {
                const n = parseInt(raw, 10)
                const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 3650)
                setShareDefaultExpiryDays(clamped)
              }}
              normalize={(raw) => {
                const n = parseInt(raw, 10)
                const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 3650)
                return String(clamped)
              }}
              placeholder="0"
              mono
            />
            <span className="text-sm text-obsidianMuted">days</span>
          </div>
        </Field>
        <Field
          label="Burn after first view"
          description="Mark /share links so the recipient's browser refuses to re-render after the first successful view. Best-effort: another device opening the same URL will still see it once."
        >
          <SettingsCheckbox
            checked={shareDefaultBurn}
            onChange={setShareDefaultBurn}
          />
        </Field>
      </div>

      {/* First-run / onboarding. Lets users re-open the Welcome tab
          after they've dismissed it — the tab no longer auto-opens
          once onboardingShown=true. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          First run
        </div>
        <ShowWelcomeButton />
      </div>
    </div>
  )
}

// Small action: open (or focus, if already open) the Welcome tab.
// Closes the Settings modal afterwards so the user lands on the tab.
function ShowWelcomeButton() {
  const closeModal = useUIStore(s => s.closeModal)
  return (
    <Field
      label="Show welcome tab"
      description="Reopens the Welcome tab with the feature-tour link, starter vaults, and getting-started shortcuts."
    >
      <button
        type="button"
        onClick={() => {
          // Avoid a static import cycle (settings panel ↔ workspace store
          // are loaded together). Dynamic import is fine — single click.
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            useWorkspaceStore.getState().openWelcome()
            closeModal()
          })
        }}
        data-testid="settings-show-welcome"
        className="px-3 py-1.5 text-sm rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianText hover:border-obsidianAccentPurple hover:bg-obsidianHighlight/40 transition-colors"
      >
        Show welcome tab
      </button>
    </Field>
  )
}
