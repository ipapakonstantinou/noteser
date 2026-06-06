// PullClassification — the discriminated-union shape every pull emits, one
// entry per remote file (and per implied directory / vault-settings change /
// orphan local note). The applyNonConflicts layer (`syncApply.ts`) consumes
// this list and either mutates the store or opens a merge tab.
//
// This file used to be a 250-line type block inside the monolithic
// `githubSync.ts`. It lives on its own now so the kinds can be referenced and
// extended without touching the much-larger pull/push orchestration files.
//
// The kinds — six "note" outcomes (`unchanged`, `remoteCreated`,
// `remoteUpdated`, `remoteDeleted`, `conflict`, `conflictDeleted`) plus the
// auto-merge, attachment, folder and vault-settings extensions — are
// documented inline below. See `docs/sync.md` for the user-facing summary of
// the six core kinds.

// `adoptPath` (pull-dedupe-by-path): present only when this classification
// is the result of the fallback reconciliation that matched a remote file to
// an UNLINKED local note (gitPath null/empty, or a stale gitPath no longer in
// the remote tree). The adopted note had no gitPath pointing at this file, so
// apply must SET note.gitPath = adoptPath. For a normal gitPath-keyed match
// the field is absent and apply leaves gitPath untouched.
export type PullClassification =
  // Local & remote agree, nothing to do. `adoptPath` is set when the match was
  // a reconciled unlinked note that still needs its gitPath linked on apply.
  | { kind: 'unchanged'; noteId: string; adoptPath?: string }
  // Remote has a file with no matching local note yet — create one.
  // progressive-clone: on a FIRST clone we emit these WITHOUT fetching the body
  // (remoteContent '', tags [], body '') and set `shell: true`. The apply layer
  // then creates a SHELL note (content '', contentLoaded false) so the sidebar
  // populates instantly; the body streams in afterwards. `shell` is absent/false
  // for an incremental pull's remoteCreated, which carries the real body as today.
  | { kind: 'remoteCreated'; path: string; remoteSha: string; remoteContent: string; tags: string[]; body: string; shell?: boolean }
  // Local exists, remote changed since our last push, local has NOT changed
  // since last sync — accept the remote version.
  | { kind: 'remoteUpdated'; noteId: string; remoteSha: string; remoteContent: string; tags: string[]; body: string; adoptPath?: string }
  // We previously pushed this note, but the file is gone from the repo and
  // we haven't edited it locally since — soft-delete it locally.
  | { kind: 'remoteDeleted'; noteId: string }
  // Both sides changed — let the user pick.
  | {
      kind: 'conflict'
      noteId: string
      path: string
      localContent: string
      remoteSha: string
      remoteContent: string
      remoteTags: string[]
      remoteBody: string
      adoptPath?: string
    }
  // Both sides changed but the line-level edits don't overlap, so we 3-way
  // merged automatically. Apply writes the merged content + pins
  // gitLastPushedSha to remoteSha so the next push uploads the union edit.
  | {
      kind: 'autoMerged'
      noteId: string
      remoteSha: string
      mergedContent: string
      adoptPath?: string
    }
  // Remote deleted the file but we edited it locally — degenerate conflict
  // that's still asking the user a question, treat it as a conflict variant.
  | {
      kind: 'conflictDeleted'
      noteId: string
      path: string
      localContent: string
    }
  // Binary attachment: remote has this file, local doesn't. Apply step fetches
  // the bytes and writes them to IDB at the same path.
  | { kind: 'attachmentCreated'; path: string; remoteSha: string; mime: string }
  // Binary attachment: local + remote both have it but content differs. We
  // treat remote as authoritative for v1 (no per-attachment three-way merge).
  | { kind: 'attachmentUpdated'; path: string; remoteSha: string; mime: string }
  // Directory the remote tree implies (via any file inside it) that we don't
  // have locally. Materialise it as an empty Folder so the sidebar reflects
  // the repo's structure — surfaces `.obsidian/` and similar dotfile dirs.
  | { kind: 'folderCreated'; path: string }
  // Vault settings file (vs8x) at `${settingsFolderPath}/settings.json`.
  // The apply step compares remoteUpdatedAt to the local store's
  // vaultSettingsUpdatedAt; if remote is newer it overwrites the local
  // vault-tagged keys. Includes the raw hash so apply can update
  // lastPushedHash atomically.
  | {
      kind: 'vaultSettingsUpdated'
      path: string
      remoteSha: string
      remoteUpdatedAt: number
      remoteVault: Record<string, unknown>
      remoteHash: string
    }
  // vs8x-conflict: both sides have drifted since the last sync. Apply
  // doesn't overwrite — instead it opens a modal where the user
  // resolves key-by-key. The classification carries every differing
  // key with its local + remote values so the modal can render
  // without a second pull.
  | {
      kind: 'vaultSettingsConflict'
      path: string
      remoteSha: string
      remoteUpdatedAt: number
      remoteVault: Record<string, unknown>
      remoteHash: string
      localVault: Record<string, unknown>
      // Just the differing keys (intersection of {present in either}
      // where local !== remote). Saves the modal from re-diffing.
      diffKeys: string[]
    }

export interface PullOutcome {
  classifications: PullClassification[]
  latestCommitSha: string
}
