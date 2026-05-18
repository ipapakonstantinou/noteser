// Orchestrates switching the notes/folders persisted-storage keys when the
// active GitHub vault changes. The flow is:
//
//   1. Compute new persist names for the target repo.
//   2. If the destination key has no data yet, copy the current key's data
//      over — this is what makes the "first time you connect a repo" case
//      behave like an import rather than wiping local notes.
//   3. Point the Zustand persist middleware at the new names and either
//      rehydrate (when there's data in the new key) or reset the store to
//      its empty defaults (when there isn't). Zustand's `rehydrate()` is a
//      no-op when storage holds nothing — without the explicit reset the
//      previous vault's notes would linger in memory.
//   4. Prune workspace tabs that referenced notes which no longer exist in
//      the new vault.
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { notesKey, foldersKey } from './repoStorage'
import type { SyncRepo } from '@/types'

interface SwitchOptions {
  // When true, copy the current key's data over to the destination if it
  // isn't there yet. Used on first connection to a repo, so local notes
  // become the seed of the new vault rather than getting orphaned.
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

  // Read the destination's presence BEFORE switching persist names so we
  // know which stores will need an explicit reset (rehydrate alone won't
  // clear in-memory state when storage is empty).
  const [notesData, foldersData] = await Promise.all([
    idbGet(targetNotesName),
    idbGet(targetFoldersName),
  ])

  useNoteStore.persist.setOptions({ name: targetNotesName })
  useFolderStore.persist.setOptions({ name: targetFoldersName })

  if (notesData !== undefined) {
    await useNoteStore.persist.rehydrate()
  } else {
    useNoteStore.setState({ notes: [], selectedNoteId: null })
  }
  if (foldersData !== undefined) {
    await useFolderStore.persist.rehydrate()
  } else {
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  }

  useWorkspaceStore.getState().pruneStaleTabs()
}
