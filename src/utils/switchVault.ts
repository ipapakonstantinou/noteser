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
//
// The `freshClone` option short-circuits this: it discards ALL local vault
// data for a true clean slate — the target's per-repo notes/folders keys, the
// globally-keyed attachments + tombstones, and the global per-sync bookkeeping
// (githubStore last-sync pointers + settingsStore per-vault sync/gitignore/
// encryption state) — then resets memory to empty so the caller can re-clone
// from the remote. Used for user-initiated repo-to-repo switches only — never
// on reload/startup, which must load the cache and keep attachments.
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGitHubStore } from '@/stores/githubStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { clearAllAttachments } from './attachments'
import { notesKey, foldersKey } from './repoStorage'
import type { SyncRepo } from '@/types'

interface SwitchOptions {
  // When true, copy the current key's data over to the destination if it
  // isn't there yet. Used on first connection to a repo, so local notes
  // become the seed of the new vault rather than getting orphaned.
  carryOver?: boolean
  // When true, DISCARD the target repo's cached per-repo vault: delete its
  // IDB keys and reset the in-memory stores to empty, so the next sync clones
  // it FRESH from the remote. Used only for an actual user-initiated
  // repo-to-repo SWITCH in GitHubRepoModal — the product decision is that we
  // do not keep repos cached in the browser, and a stale cache (from an older
  // duplication bug) could otherwise break sync. Mutually exclusive with
  // carryOver: when freshClone is true, carryOver is ignored (we never copy
  // data in). NOTE: the reload/startup paths (runPull guard, page.tsx
  // migration) must NOT set this — they rely on loading the cache.
  freshClone?: boolean
}

export async function switchVault(
  toRepo: SyncRepo | null,
  { carryOver = false, freshClone = false }: SwitchOptions = {},
): Promise<void> {
  const currentNotesName = useNoteStore.persist.getOptions().name as string
  const currentFoldersName = useFolderStore.persist.getOptions().name as string
  const targetNotesName = notesKey(toRepo)
  const targetFoldersName = foldersKey(toRepo)

  if (currentNotesName === targetNotesName && currentFoldersName === targetFoldersName) {
    return
  }

  // Fresh-clone path: discard the target's cached vault and reset memory to
  // empty so the caller's auto-sync re-clones it from the remote. This is an
  // early return — none of the carryOver / cache-load logic below runs.
  if (freshClone) {
    await idbDel(targetNotesName)
    await idbDel(targetFoldersName)

    // Attachments live under a GLOBAL prefix (noteser-attachment:<path>), not
    // per-repo, so deleting the notes/folders keys above leaves them behind.
    // Wipe them (plus tombstones + URL cache) so the previous vault's binaries
    // don't bleed into the new repo. Awaited; best-effort (never throws).
    await clearAllAttachments()

    useNoteStore.persist.setOptions({ name: targetNotesName })
    useFolderStore.persist.setOptions({ name: targetFoldersName })

    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    // Per-sync bookkeeping is also global (not per-repo). Reset it so the new
    // repo starts from a clean slate and the subsequent runSync() clones fresh
    // instead of reconciling against the previous repo's commit/settings state.
    //
    // githubStore: clear the last-sync pointers ONLY. Token / user / syncRepo
    // (the GitHub connection itself) are deliberately untouched.
    useGitHubStore.setState({ lastCommitSha: null, lastSyncedAt: null })

    // settingsStore: reset ONLY the per-vault sync state — the gitignore
    // overlay/draft/snapshot, the vault-settings push bookkeeping, and the
    // per-vault encryption salt/canary/flag. User preferences (theme,
    // shortcuts, aiProvider, sync cadence, ribbon/sidebar layout, etc.) are
    // device/user-scoped and MUST survive a repo switch — they are left alone.
    useSettingsStore.setState({
      vaultSettingsUpdatedAt: 0,
      vaultSettingsLastPushedHash: '',
      vaultGitignoreDraft: null,
      vaultGitignoreRemoteSnapshot: null,
      localGitignoreOverlay: '',
      vaultEncryptionEnabled: false,
      vaultEncryptionSalt: null,
      vaultEncryptionCanary: null,
    })

    useWorkspaceStore.getState().pruneStaleTabs()
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
