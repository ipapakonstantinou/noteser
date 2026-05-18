// Orchestrates switching the notes/folders persisted-storage keys when the
// active GitHub vault changes. The flow is:
//
//   1. Compute new persist names for the target repo.
//   2. If the destination key has no data yet, copy the current key's data
//      over — this is what makes the "first time you connect a repo" case
//      behave like an import rather than wiping local notes.
//   3. Point the Zustand persist middleware at the new names and rehydrate
//      so the in-memory store reflects whatever was on disk.
//   4. Prune workspace tabs that referenced notes which no longer exist in
//      the new vault.
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { notesKey, foldersKey } from './repoStorage'
import type { SyncRepo } from '@/types'

interface SwitchOptions {
  // When true, never copy the current key's data over to the destination.
  // Used by the "switch anyway" path so the previous vault's unpushed
  // changes stay quarantined in their own key instead of leaking through.
  carryOver?: boolean
}

export async function switchVault(
  toRepo: SyncRepo | null,
  { carryOver = false }: SwitchOptions = {},
): Promise<void> {
  const currentNotesName = useNoteStore.persist.getOptions().name as string
  const currentFoldersName = useFolderStore.persist.getOptions().name as string
  const targetNotesName = notesKey(toRepo)
  const targetFoldersName = foldersKey(toRepo)

  if (currentNotesName === targetNotesName && currentFoldersName === targetFoldersName) {
    return
  }

  if (carryOver) {
    const destNotes = await idbGet(targetNotesName)
    if (destNotes === undefined) {
      const srcNotes = await idbGet(currentNotesName)
      if (srcNotes !== undefined) await idbSet(targetNotesName, srcNotes)
    }
    const destFolders = await idbGet(targetFoldersName)
    if (destFolders === undefined) {
      const srcFolders = await idbGet(currentFoldersName)
      if (srcFolders !== undefined) await idbSet(targetFoldersName, srcFolders)
    }
  }

  useNoteStore.persist.setOptions({ name: targetNotesName })
  useFolderStore.persist.setOptions({ name: targetFoldersName })

  await Promise.all([
    useNoteStore.persist.rehydrate(),
    useFolderStore.persist.rehydrate(),
  ])

  useWorkspaceStore.getState().pruneStaleTabs()
}
