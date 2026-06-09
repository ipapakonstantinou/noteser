// Thin barrel re-export for the post-split GitHub sync stack. Issue #77 split
// the original ~1600-line `githubSync.ts` monolith into focused submodules
// under `./githubSync/`:
//
//   - `syncClassify.ts` — the `PullClassification` discriminated-union the
//     pull emits and the apply layer consumes.
//   - `syncPull.ts`     — `pullFromGitHub`, `pullFromZipball`, and the
//     zipball attachment side-channel cache.
//   - `syncPush.ts`     — `syncToGitHub` and the upload-cache plumbing.
//   - `internal.ts`     — path/serialization/encryption helpers shared by
//     both halves.
//
// External callers (hooks, components, tests) keep importing from
// `@/utils/githubSync` so the split is transparent. New code that lives
// inside the sync pipeline should import directly from the submodule it
// belongs in.

export {
  // Path computation
  notePath,
  pushPath,
  // MIME helpers (also used by tests)
  guessMimeFromPath,
  // Foreign-vault-file classifier (non-md, non-attachment vault files we
  // mirror in the tree as un-openable entries — see syncPull / syncPush).
  isForeignVaultFile,
  // Note serialization + parser
  serializeNote,
  normalizeForPush,
  isUnchangedModuloNormalization,
  parseNote,
  // Public sync result shape
  type ParsedNote,
  type SyncResult,
} from './githubSync/internal'

export {
  pullFromGitHub,
  pullFromZipball,
  takeZipballAttachmentBytes,
} from './githubSync/syncPull'

export {
  syncToGitHub,
  _resetUploadedShaCache,
  type PushProgress,
  type SyncInput,
  type SyncOutcome,
  type GitPathUpdate,
} from './githubSync/syncPush'

export {
  type PullClassification,
  type PullOutcome,
} from './githubSync/syncClassify'
