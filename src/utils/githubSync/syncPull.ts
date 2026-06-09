// Pull half of the sync pipeline. Consumes the Git Data API (one-tree-fetch
// + lazy per-blob reads) to produce a list of `PullClassification` entries
// the apply layer can act on. Also hosts the zipball fast-path used for
// first-time clones of large vaults.
//
// Split out of the monolithic `githubSync.ts` so the pull-specific logic can
// be read and tested in isolation. The public surface is preserved verbatim
// via the `../githubSync.ts` barrel — external callers should keep importing
// from `@/utils/githubSync`.

import type JSZip from 'jszip'
import type { Note, SyncRepo } from '@/types'
import {
  getBranchRefSha,
  getCommitTreeSha,
  gitBlobSha,
  gitBlobShaBytes,
  fetchZipball,
} from '../github'
// #69: pull-side blob/tree reads go through the ETag-conditional wrappers
// so a re-sync of an unchanged repo comes back as 304s and doesn't burn
// quota. Push-side reads in `syncPush.ts` still call the bare helpers from
// `../github` — the cache is read-side only.
import {
  getBlobContentConditional,
  getTreeMapConditional,
} from '../githubETagCache'
import { threeWayMerge } from '../lineDiff'
import {
  isAttachmentPath,
  listAttachmentPaths,
  getAttachmentGitSha,
} from '../attachments'
import {
  maybeDecryptFromPull,
  notePath,
  collectLocalFolderRepoPaths,
  serializeNote,
  parseNote,
  guessMimeFromPath,
  isForeignVaultFile,
} from './internal'
import type { PullClassification, PullOutcome } from './syncClassify'

export async function pullFromGitHub(input: {
  token: string
  repo: SyncRepo
  notes: Note[]
  folders: import('@/types').Folder[]
  // Repo paths the user explicitly deleted (folderStore.
  // deletedFolderPaths). Step 1b skips dir-walk for any path
  // matching one of these, OR nested inside one of these, so
  // hidden/system folders the user removed don't auto-re-derive.
  excludedFolderPaths?: string[]
  // Vault settings file path (vs8x). When set, the pull looks for this
  // path in the remote tree and emits a `vaultSettingsUpdated`
  // classification if the remote's embedded updatedAt is newer than
  // localVaultUpdatedAt. Pass null / undefined to skip settings pull.
  vaultSettingsPath?: string | null
  vaultSettingsLocalUpdatedAt?: number
  // progressive-clone: when true the caller has determined this is a first
  // clone (no local notes/folders to reconcile), so every remote .md is
  // `remoteCreated`. We emit them as SHELLS (empty body, shell:true) WITHOUT
  // fetching any blob bodies — the sidebar populates instantly and bodies
  // stream in afterwards. Omit/false for incremental pulls so they classify +
  // fetch normally (lazily, only what the diff needs).
  isFirstClone?: boolean
  // Legacy progress hook from the prefetch era — no longer fired by
  // pullFromGitHub now that the first clone is shell-only (there is no blob
  // prefetch to report). Kept on the interface for back-compat with callers
  // that still pass it; harmless. The progressive background fill reports its
  // own progress via the onPhase callback wired in useGitHubSync.
  onBlobProgress?: (loaded: number, total: number) => void
}): Promise<PullOutcome> {
  const { token, repo, notes } = input
  const excluded = input.excludedFolderPaths ?? []
  const vaultSettingsPath = input.vaultSettingsPath ?? null
  const vaultSettingsLocalUpdatedAt = input.vaultSettingsLocalUpdatedAt ?? 0
  const isFirstClone = input.isFirstClone ?? false
  const { owner, name, branch } = repo
  const headSha = await getBranchRefSha(token, owner, name, branch)
  const treeSha = await getCommitTreeSha(token, owner, name, headSha)
  const remoteTree = await getTreeMapConditional(token, repo, treeSha)

  // Build the gitignore matcher BEFORE walking the tree so step 1's
  // .md loop can short-circuit on ignored paths. The matcher is also
  // reused for step 1b (folder derivation), 1c (attachments), and
  // step 2 (orphan detection).
  // Layered gitignore (gi9n):
  //   1. baked-in OS-junk defaults (.DS_Store, Thumbs.db, *.tmp, *.swp)
  //   2. the vault's remote `.gitignore` (if any)
  //   3. the per-device overlay from settingsStore
  // Each layer is appended after the previous so a later negation
  // (e.g. `!keep.tmp` in the overlay) can un-ignore an earlier rule.
  // We ALWAYS include the defaults — otherwise an empty remote with
  // an empty overlay would lose the OS-junk fallback.
  const { parseGitignore, DEFAULT_MATCHER, DEFAULT_IGNORE_LINES, GITIGNORE_PATH } = await import('../gitignore')
  let gitignoreMatcher = DEFAULT_MATCHER
  const gitignoreSha = remoteTree.get(GITIGNORE_PATH)
  let remoteRaw = ''
  if (gitignoreSha) {
    try {
      remoteRaw = await getBlobContentConditional(token, repo, gitignoreSha)
    } catch {
      remoteRaw = ''
    }
  }
  try {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const overlay = useSettingsStore.getState().localGitignoreOverlay || ''
    const combined = [
      DEFAULT_IGNORE_LINES.join('\n'),
      remoteRaw,
      overlay,
    ].filter(s => s && s.trim().length > 0).join('\n')
    gitignoreMatcher = parseGitignore(combined)
  } catch {
    // Defaults already applied above — pulls shouldn't die over a
    // malformed ignore file or a missing store.
  }

  const out: PullClassification[] = []
  const seenLocalIds = new Set<string>()

  // progressive-clone: a FIRST clone NO LONGER prefetches blob bodies here.
  // We walk the tree (already one call) for titles/paths/SHAs only and emit
  // SHELL `remoteCreated` classifications with an EMPTY body. The sidebar then
  // populates instantly from those shells; the bodies stream in afterwards via
  // the background fill (useGitHubSync wires that up) and on-open. This keeps
  // the prefetch map empty on a first clone — the classify loop's `shell`
  // branch never calls loadRemote, so no per-blob network trips happen during
  // the pull. Incremental pulls keep the lazy per-blob fetch unchanged.
  //
  // (The old behaviour pre-fetched ALL .md blobs with bounded concurrency. That
  // still avoided the per-file watchdog blowout but blocked the sidebar on the
  // whole download; the progressive shell approach is strictly faster to first
  // paint.)
  const prefetchedBlobs = new Map<string, string>()

  // 1. Walk every remote .md file.
  for (const [path, remoteSha] of remoteTree) {
    if (!path.endsWith('.md')) continue
    if (gitignoreMatcher.isIgnored(path)) continue
    // Look up by gitPath in ALL notes (incl. soft-deleted). A
    // soft-deleted note at the same path means the user explicitly
    // wants this gone — we MUST NOT treat the remote file as a new
    // creation and resurrect it. Push step 4 will emit the
    // `sha: null` tree entry to actually delete it.
    let localMatch = notes.find(n => n.gitPath === path)

    if (localMatch && localMatch.isDeleted) {
      // Pending deletion — skip the fetch + classification entirely.
      // seenLocalIds includes it so the orphan-detection branch below
      // doesn't double-count.
      seenLocalIds.add(localMatch.id)
      out.push({ kind: 'unchanged', noteId: localMatch.id })
      continue
    }

    // progressive-clone CORE SAFETY GUARD: a SHELL note (body not yet loaded)
    // must NEVER be classified as anything but `unchanged`. Its `content` is ''
    // (a placeholder, not the real body), so computing a local blob SHA from it
    // would produce the SHA of an empty file — which mismatches the real remote
    // blob and would (a) re-classify the note as a local edit and (b) on push
    // overwrite the real remote file with an empty body. We short-circuit BEFORE
    // serializeNote / gitBlobSha / loadRemote so no body work happens at all.
    // The background fill / on-open path will load the body and re-classify the
    // note normally once `contentLoaded` flips true. (gitLastPushedSha is also
    // pinned to remoteSha for shells, so even without this guard a SHELL whose
    // remote is unchanged would read unchanged — but this guard makes it
    // unconditional and avoids the empty-body SHA computation entirely.)
    if (localMatch && localMatch.contentLoaded === false) {
      seenLocalIds.add(localMatch.id)
      out.push({ kind: 'unchanged', noteId: localMatch.id })
      continue
    }

    // Fetch the remote content lazily — only when we need it. bke1:
    // decrypt the envelope when encryption is on; throws VaultLockedError
    // upstream if the user hasn't unlocked.
    let remoteContent: string | null = null
    const loadRemote = async () => {
      if (remoteContent === null) {
        // Prefer the blob we already pulled in the first-clone prefetch; only
        // hit the network on a miss (incremental pulls, or a blob the prefetch
        // didn't cover). The conditional read may itself be served from the
        // ETag cache and short-circuit before hitting the network. decrypt
        // runs here either way.
        const raw = prefetchedBlobs.get(remoteSha) ?? await getBlobContentConditional(token, repo, remoteSha)
        remoteContent = await maybeDecryptFromPull(raw)
      }
      return remoteContent
    }

    // pull-dedupe-by-path: no gitPath-keyed match. Before declaring this a
    // brand-new remote file (which apply would materialise as a NEW note), try
    // a fallback reconciliation: is there an UNLINKED local note that logically
    // IS this file? "Unlinked" = gitPath null/empty, OR a stale gitPath that is
    // no longer present in this pull's remote tree. We match by the note's
    // computed repo path (notePath) === this remote path. Adopting prevents the
    // duplicate (the "two Temp notes" twin) for an unpushed local note or one
    // whose gitPath was cleared (e.g. a conflictDeleted respawn).
    //
    // `adoptPath` is the path we'll thread onto the resulting classification so
    // the apply layer links the adopted note's gitPath. Left undefined for a
    // normal gitPath-keyed match.
    let adoptPath: string | undefined
    if (!localMatch) {
      // rename-not-delete: an "unlinked" local note is one that has no gitPath
      // pointing at a file in THIS remote tree — either never pushed, or its
      // stored gitPath is stale (a rename/respawn left it behind). Such a note
      // is a candidate to ADOPT this remote file.
      const isUnlinked = (n: Note): boolean => {
        const gp = n.gitPath
        if (!gp) return true
        return !remoteTree.has(gp)
      }
      // Path-form match: the note's computed repo path equals this remote path.
      const pathCandidates = notes.filter(n => {
        if (n.isDeleted) return false
        if (seenLocalIds.has(n.id)) return false
        if (notePath(n, input.folders) !== path) return false
        return isUnlinked(n)
      })

      if (pathCandidates.length === 1) {
        localMatch = pathCandidates[0]
        adoptPath = path
      } else if (pathCandidates.length > 1) {
        // Ambiguous — be conservative. Only adopt if EXACTLY ONE candidate's
        // serialized blob SHA equals the remote SHA (a clean, identical adopt
        // we can make with confidence). Otherwise we refuse to guess and fall
        // through to remoteCreated rather than risk merging the wrong note.
        const shaMatches: Note[] = []
        for (const c of pathCandidates) {
          const sha = await gitBlobSha(serializeNote(c))
          if (sha === remoteSha) shaMatches.push(c)
        }
        if (shaMatches.length === 1) {
          localMatch = shaMatches[0]
          adoptPath = path
        }
      }

      // rename-not-delete CONTENT-HASH ADOPTION: the path FORM differs (e.g. the
      // note's stored gitPath/folder names are dash-form, the remote reverted to
      // space-form), so notePath() no longer equals the remote path and the
      // path-match above found nothing. Fall back to matching by CONTENT: an
      // unlinked local note whose serialized blob SHA equals this remote blob
      // (or whose last-pushed SHA equals it) logically IS this file under a new
      // name. Adopting it (gitPath := remotePath) prevents the catastrophic
      // "old-path deleted + new-path created" misread that soft-deletes the note
      // and then deletes the real remote file. We only adopt on an UNAMBIGUOUS
      // single content match, mirroring the conservative SHA tiebreak above.
      if (!localMatch) {
        const hashMatches: Note[] = []
        for (const n of notes) {
          if (n.isDeleted) continue
          if (seenLocalIds.has(n.id)) continue
          if (!isUnlinked(n)) continue
          // Content-hash adoption is for RENAMES: a note that was PUSHED before
          // (so it has a baseline gitPath + last-pushed SHA) whose stored path
          // FORM no longer matches the remote. A never-pushed note (no gitPath
          // AND no gitLastPushedSha) is the job of the notePath path-form match
          // above — adopting it here by raw content equality is both unnecessary
          // and riskier (it could vacuum up an unrelated local draft that merely
          // happens to share bytes). Require a push lineage to qualify.
          if (!n.gitPath && !n.gitLastPushedSha) continue
          // Cheap check first: the note's recorded last-pushed SHA already
          // equals this remote blob (it was pushed as this exact content).
          if (n.gitLastPushedSha === remoteSha) { hashMatches.push(n); continue }
          // Otherwise hash the note's current serialized content.
          const sha = await gitBlobSha(serializeNote(n))
          if (sha === remoteSha) hashMatches.push(n)
        }
        if (hashMatches.length === 1) {
          localMatch = hashMatches[0]
          adoptPath = path
        }
      }
    }

    if (!localMatch) {
      // progressive-clone: on a FIRST clone, emit a SHELL — no body fetch. The
      // apply layer materialises a placeholder note (content '', contentLoaded
      // false) so the sidebar populates instantly; the body streams in later.
      if (isFirstClone) {
        out.push({ kind: 'remoteCreated', path, remoteSha, remoteContent: '', tags: [], body: '', shell: true })
        continue
      }
      const content = await loadRemote()
      const parsed = parseNote(content)
      out.push({ kind: 'remoteCreated', path, remoteSha, remoteContent: content, tags: parsed.tags, body: parsed.body })
      continue
    }

    seenLocalIds.add(localMatch.id)
    const localContent = serializeNote(localMatch)
    const localBlobSha = await gitBlobSha(localContent)

    if (localBlobSha === remoteSha) {
      // Even for a clean `unchanged`, an adopted note still needs its gitPath
      // linked on apply — thread adoptPath through.
      out.push({ kind: 'unchanged', noteId: localMatch.id, ...(adoptPath ? { adoptPath } : {}) })
      continue
    }

    // Two distinct SHAs (the two-SHA split that fixes silent conflict loss):
    //   - localChanged compares the canonical LOCAL bytes against the local
    //     baseline (gitLastPushedSha). For a frontmatter note this baseline is
    //     the SHA of the TRANSFORMED body the app stores, so an untouched note
    //     hashes back to it → localChanged = false (no phantom drift).
    //   - remoteChanged compares the current remote blob SHA against the REMOTE
    //     blob we last synced against (gitRemoteBaseSha). That blob is the raw
    //     remote file (with frontmatter), which is exactly what the three-way
    //     ancestor fetch needs.
    // Un-migrated notes (synced before gitRemoteBaseSha existed) have no remote
    // base — fall back to gitLastPushedSha to preserve the prior behaviour
    // until their next sync rewrites both fields.
    const localBaseline = localMatch.gitLastPushedSha ?? null
    const remoteBase = localMatch.gitRemoteBaseSha ?? localMatch.gitLastPushedSha ?? null
    const remoteChanged = remoteBase !== remoteSha
    const localChanged = localBaseline !== localBlobSha

    if (!remoteChanged && !localChanged) {
      // Neither side moved since the last sync. The raw remote blob SHA still
      // differs from our canonical local SHA (that's normal for a frontmatter
      // note: we store a transformed body) — but nothing has actually changed,
      // so this is `unchanged`. Without this branch a frontmatter note would
      // fall through to "remoteUnchanged + localChanged → push", silently
      // re-pushing on every sync (the storm) AND never settling to unchanged.
      out.push({ kind: 'unchanged', noteId: localMatch.id, ...(adoptPath ? { adoptPath } : {}) })
    } else if (remoteChanged && !localChanged) {
      const content = await loadRemote()
      const parsed = parseNote(content)
      out.push({ kind: 'remoteUpdated', noteId: localMatch.id, remoteSha, remoteContent: content, tags: parsed.tags, body: parsed.body, ...(adoptPath ? { adoptPath } : {}) })
    } else if (remoteChanged && localChanged) {
      const content = await loadRemote()
      const parsed = parseNote(content)

      // Try a line-level 3-way merge before bothering the user. If the local
      // and remote edits don't overlap line-wise we can auto-merge and the
      // user never sees the conflict tab. The common ancestor is the REMOTE
      // blob we last synced against (`gitRemoteBaseSha`, fetchable via
      // getBlobContentConditional) — NOT gitLastPushedSha, which is the SHA of
      // the transformed local bytes and may not exist as a remote blob at all.
      // Anything that goes wrong (no ancestor sha, blob GC'd, network hiccup,
      // overlapping edits) falls back to the existing manual conflict flow.
      let autoMerged: string | null = null
      if (remoteBase) {
        try {
          const ancestorRaw = await getBlobContentConditional(token, repo, remoteBase)
          const ancestor = await maybeDecryptFromPull(ancestorRaw)
          const merged = threeWayMerge(ancestor, localContent, content)
          if (merged.ok) autoMerged = merged.merged
        } catch {
          // Swallow — fall through to conflict.
        }
      }

      if (autoMerged !== null) {
        out.push({
          kind: 'autoMerged',
          noteId: localMatch.id,
          remoteSha,
          mergedContent: autoMerged,
          ...(adoptPath ? { adoptPath } : {}),
        })
      } else {
        out.push({
          kind: 'conflict',
          noteId: localMatch.id,
          path,
          localContent,
          remoteSha,
          remoteContent: content,
          remoteTags: parsed.tags,
          remoteBody: parsed.body,
          ...(adoptPath ? { adoptPath } : {}),
        })
      }
    }
    // remoteUnchanged + localChanged → handled by the push phase, nothing here.
  }

  // 1b. Empty / non-syncable directories the remote implies. We classify
  // every parent directory of every blob; the apply step calls
  // ensureFolderPath on each, so dotfile dirs like `.obsidian/` and
  // `.obsidian/themes/` show in the sidebar even though we don't pull their
  // file contents. The `attachments/` tree is excluded — it stays rendered
  // by the sidebar's synthetic folder, not as a real Folder entity.
  //
  // Skip "dying" paths: blobs whose matched local note is soft-deleted, OR
  // whose matched note's desired path differs from its stale gitPath (the
  // note moved — push will sha:null the old path). Without this skip,
  // deleting a folder re-derives it on the very next pull because the
  // moved-to-root notes still carry the old gitPath. See bug "delete
  // hidden folder, it appears again."
  const localFolderPaths = collectLocalFolderRepoPaths(input.folders)
  const pendingRemovedPaths = new Set<string>()
  for (const [path] of remoteTree) {
    if (!path.endsWith('.md')) continue
    const localMatch = notes.find(n => n.gitPath === path)
    if (!localMatch) continue
    if (localMatch.isDeleted) {
      pendingRemovedPaths.add(path)
      continue
    }
    const desiredPath = notePath(localMatch, input.folders)
    if (desiredPath !== path) pendingRemovedPaths.add(path)
  }
  // Helper: is `dir` either tombstoned itself or nested inside a
  // tombstoned ancestor? Linear scan over `excluded` — list is tiny
  // (one entry per explicit user-delete) so a Set+walk isn't worth it.
  const isExcluded = (dir: string): boolean => {
    for (const ex of excluded) {
      if (dir === ex) return true
      if (dir.startsWith(`${ex}/`)) return true
    }
    return false
  }
  const seenDirPaths = new Set<string>()
  for (const [path] of remoteTree) {
    if (pendingRemovedPaths.has(path)) continue
    // Skip dir-walk for ignored files — they shouldn't surface their
    // parent directories either. Otherwise an ignored `.DS_Store` in
    // a subfolder would still cause the subfolder to be derived.
    if (gitignoreMatcher.isIgnored(path)) continue
    let cur = path
    while (true) {
      const lastSlash = cur.lastIndexOf('/')
      if (lastSlash === -1) break
      cur = cur.slice(0, lastSlash)
      if (!cur) break
      if (seenDirPaths.has(cur)) break
      seenDirPaths.add(cur)
      if (localFolderPaths.has(cur)) continue
      if (isExcluded(cur)) continue
      if (gitignoreMatcher.isIgnored(cur, true)) continue
      out.push({ kind: 'folderCreated', path: cur })
    }
  }

  // 1d. Vault settings file (vs8x). If the caller is opting in
  // (vaultSettingsPath set) and the remote has the file, fetch it,
  // parse, and emit a classification iff its embedded updatedAt is
  // strictly newer than ours. Equal or older → skip (LWW with us as
  // the tiebreaker so a clean re-push doesn't clobber a slightly
  // newer local edit).
  if (vaultSettingsPath) {
    const remoteSettingsSha = remoteTree.get(vaultSettingsPath)
    if (remoteSettingsSha) {
      try {
        const raw = await getBlobContentConditional(token, repo, remoteSettingsSha)
        const { parseVaultSettings, vaultSettingsHash, pickVaultSlice, serializeVaultSettings } = await import('../vaultSettings')
        const parsed = parseVaultSettings(raw)
        if (parsed && parsed.updatedAt > vaultSettingsLocalUpdatedAt) {
          const remoteHash = vaultSettingsHash(raw)
          // vs8x-conflict: are local AND remote both dirty since the
          // last sync? If localHash !== lastPushedHash the user has
          // edits we never pushed — overlaying the remote silently
          // would clobber them. Open a modal instead.
          const { useSettingsStore } = await import('@/stores/settingsStore')
          const settingsState = useSettingsStore.getState()
          const localVaultSlice = pickVaultSlice(settingsState)
          const localCanonical = serializeVaultSettings(localVaultSlice, settingsState.vaultSettingsUpdatedAt || 0)
          const localHash = vaultSettingsHash(localCanonical)
          const localDirty = localHash !== (settingsState.vaultSettingsLastPushedHash || '')

          const remoteVaultObj = parsed.vault as Record<string, unknown>
          const localVaultObj = localVaultSlice as Record<string, unknown>

          if (localDirty) {
            // Build the diff key list — every key whose local + remote
            // values differ. Both sides whitelist to VAULT_SETTING_KEYS
            // already, so the comparison stays small.
            const keys = new Set<string>([
              ...Object.keys(localVaultObj),
              ...Object.keys(remoteVaultObj),
            ])
            const diffKeys: string[] = []
            for (const k of keys) {
              if (JSON.stringify(localVaultObj[k]) !== JSON.stringify(remoteVaultObj[k])) {
                diffKeys.push(k)
              }
            }
            if (diffKeys.length > 0) {
              out.push({
                kind: 'vaultSettingsConflict',
                path: vaultSettingsPath,
                remoteSha: remoteSettingsSha,
                remoteUpdatedAt: parsed.updatedAt,
                remoteVault: remoteVaultObj,
                remoteHash,
                localVault: localVaultObj,
                diffKeys,
              })
            }
            // If diffKeys is empty the values match anyway → fall
            // through to vaultSettingsUpdated which is a cheap no-op.
            else {
              out.push({
                kind: 'vaultSettingsUpdated',
                path: vaultSettingsPath,
                remoteSha: remoteSettingsSha,
                remoteUpdatedAt: parsed.updatedAt,
                remoteVault: remoteVaultObj,
                remoteHash,
              })
            }
          } else {
            // Clean local → remote wins as before.
            out.push({
              kind: 'vaultSettingsUpdated',
              path: vaultSettingsPath,
              remoteSha: remoteSettingsSha,
              remoteUpdatedAt: parsed.updatedAt,
              remoteVault: remoteVaultObj,
              remoteHash,
            })
          }
        }
      } catch {
        // Bad JSON / network blip — skip rather than fail the entire
        // pull. The settings file is a soft signal; notes still sync.
      }
    }
  }

  // 1c-foreign. Non-md, non-attachment files we want visible in the tree as
  // un-openable entries. We emit a `foreignFile` classification only when no
  // local foreign Note already mirrors the path — every other case (already
  // mirrored, soft-deleted locally) is a no-op so we never resurrect a
  // tombstoned mirror or duplicate-create on repeated pulls. The body is
  // intentionally NOT fetched: a canvas/base file can be megabytes and is not
  // rendered locally yet. The push side (`syncPush.ts`) skips `kind: 'foreign'`
  // notes so a mirror can never overwrite the real remote file with empty
  // bytes.
  for (const [path, remoteSha] of remoteTree) {
    if (!isForeignVaultFile(path)) continue
    if (gitignoreMatcher.isIgnored(path)) continue
    const existing = notes.find(n => n.gitPath === path)
    if (existing) continue
    out.push({ kind: 'foreignFile', path, remoteSha })
  }

  // 1c. Binary attachments under `attachments/`. Compare each remote entry
  // against the local IDB store; queue creates/updates so syncApply can fetch
  // the bytes lazily (each blob fetch is its own API call, so we only pay
  // for ones the user actually needs).
  const localAttachmentPaths = new Set(await listAttachmentPaths())
  for (const [path, remoteSha] of remoteTree) {
    if (!isAttachmentPath(path)) continue
    if (gitignoreMatcher.isIgnored(path)) continue
    // Best-effort MIME guess from extension — the apply step uses this to
    // build the Blob. Falls back to octet-stream.
    const mime = guessMimeFromPath(path)
    if (!localAttachmentPaths.has(path)) {
      out.push({ kind: 'attachmentCreated', path, remoteSha, mime })
      continue
    }
    const localSha = await getAttachmentGitSha(path)
    if (localSha && localSha !== remoteSha) {
      out.push({ kind: 'attachmentUpdated', path, remoteSha, mime })
    }
  }

  // 2. Local notes that had a gitPath but are missing from the remote tree.
  for (const note of notes) {
    if (note.isDeleted || !note.gitPath || seenLocalIds.has(note.id)) continue
    if (remoteTree.has(note.gitPath)) continue
    // foreign-vault-files: a foreign mirror whose remote file is gone is a
    // clean delete. There is nothing the user could have edited locally (the
    // mirror is empty + read-only), so always `remoteDeleted` — no conflict
    // path to consider, no content-SHA computation needed.
    if (note.kind === 'foreign') {
      out.push({ kind: 'remoteDeleted', noteId: note.id })
      continue
    }
    // Was it deleted on the remote?
    const lastPushed = note.gitLastPushedSha ?? null
    const localContent = serializeNote(note)
    const localBlobSha = await gitBlobSha(localContent)
    if (lastPushed && lastPushed === localBlobSha) {
      // We haven't touched it locally since the last push → accept the delete.
      out.push({ kind: 'remoteDeleted', noteId: note.id })
    } else if (lastPushed) {
      // Remote deleted, local has edits since the last sync → conflict.
      out.push({ kind: 'conflictDeleted', noteId: note.id, path: note.gitPath, localContent })
    }
    // No lastPushed → this note was never actually synced (clear stale gitPath
    // and let push re-create it). Treat as remoteDeleted to just clear state.
    else {
      out.push({ kind: 'remoteDeleted', noteId: note.id })
    }
  }

  // Offline-first Step 1 (#68): record an anchor for the next boot. The
  // snapshot is the pair (commit, tree-map) we just classified against. On
  // a subsequent reload the offline boot path reads this without needing
  // the network so the sidebar can show "cached at <sha> · <time>", and
  // the next online pull can short-circuit if HEAD still matches. Cache
  // write is fire-and-forget — a write failure must NOT fail the sync.
  void (async () => {
    try {
      const { writeVaultSnapshot, buildSnapshot } = await import('../vaultSnapshotCache')
      await writeVaultSnapshot(repo, buildSnapshot(headSha, remoteTree))
    } catch {
      /* best-effort */
    }
  })()

  return { classifications: out, latestCommitSha: headSha }
}

// ── Bulk first-clone (zipball fast path) ────────────────────────────────────
//
// `pullFromGitHub` is correct but does one blob fetch per file that differs
// from local. On a first connection to a large vault (thousands of files) we
// already know everything is `remoteCreated`, so the per-file API trip is
// pure waste — we'd burn rate limit and minutes of wall time. The zipball
// endpoint hands us the whole repo as a single zip download, which the
// browser already follows past a redirect on its own and which doesn't get
// charged against the primary API rate limit the way blob reads do.
//
// We still need authoritative blob SHAs to seed `gitLastPushedSha`. Computing
// them locally via `gitBlobSha` produces the same hash git would (it's the
// same SHA-1 of `blob <len>\0<content>`), so a separate tree fetch isn't
// necessary.
export async function pullFromZipball(input: {
  token: string
  repo: SyncRepo
  // Phase hint so the caller can surface "Downloading vault (retrying)…" when
  // a corrupted/truncated archive triggers a re-download. Optional — the retry
  // loop works regardless.
  onPhase?: (msg: string) => void
}): Promise<PullOutcome> {
  const { token, repo, onPhase } = input
  const { owner, name, branch } = repo

  // The ref is cheap and we need it for `latestCommitSha` regardless — fetch
  // it once up front, independent of the archive retry loop below.
  const headSha = await getBranchRefSha(token, owner, name, branch)

  // Lazy-load jszip — only callers of pullFromZipball pay the
  // ~140kB cost. The rest of the sync flow (push, regular pull via
  // Git Data API) never touches it.
  const { default: JSZip } = await import('jszip')

  // Download + parse the archive with a short retry loop. On a large vault
  // over a flaky mobile connection the single big zip download sometimes
  // arrives truncated, so JSZip throws "Corrupted zip: can't find end of
  // central directory" (or fetchZipball's own Content-Length guard fires).
  // Both are transient — re-downloading usually succeeds within a couple of
  // tries, so we do that automatically instead of making the user tap Retry.
  // Only after exhausting the attempts do we surface the error (→ existing
  // toast with Retry). The per-request 180s timeout inside fetchZipball is
  // unchanged; this loop wraps whole-download attempts, not single requests.
  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [500, 1_000]
  let zip: JSZip
  let attempt = 0
  for (;;) {
    try {
      const zipBuffer = await fetchZipball(token, owner, name, branch)
      zip = await JSZip.loadAsync(zipBuffer)
      break
    } catch (err) {
      attempt++
      if (attempt >= MAX_ATTEMPTS) throw err
      // Short backoff before re-downloading, and tell the UI we're retrying —
      // with the attempt number, so a flaky large-vault download reads as
      // progress, not a stall. (attempt was just incremented; the next try is
      // attempt + 1.)
      onPhase?.(`Vault download incomplete, retrying (${attempt + 1} of ${MAX_ATTEMPTS})…`)
      const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }
  const classifications: PullClassification[] = []

  // The zipball wraps every entry in a top-level directory named
  // `<owner>-<repo>-<short-sha>/`, so we strip the first path segment.
  const entries: Array<{ rel: string; file: JSZip.JSZipObject }> = []
  zip.forEach((rel, file) => {
    if (file.dir) return
    // Pull both .md notes and binary files under the attachments folder
    // (configured or historical default). Anything else in the repo (root
    // README, .github/, etc.) is ignored on the first clone.
    if (rel.endsWith('.md')) {
      entries.push({ rel, file })
      return
    }
    const slashIdx = rel.indexOf('/')
    if (slashIdx !== -1 && isAttachmentPath(rel.slice(slashIdx + 1))) {
      entries.push({ rel, file })
    }
  })

  for (const { rel, file } of entries) {
    const slashIdx = rel.indexOf('/')
    if (slashIdx === -1) continue
    const path = rel.slice(slashIdx + 1)

    if (path.endsWith('.md')) {
      const raw = await file.async('string')
      // bke1: zipball blobs were written in the encrypted wire form. We
      // compute the remoteSha against that wire form (matches what
      // GitHub stored) but feed parseNote the decrypted body.
      const remoteSha = await gitBlobSha(raw)
      const content = await maybeDecryptFromPull(raw)
      const parsed = parseNote(content)

      classifications.push({
        kind: 'remoteCreated',
        path,
        remoteSha,
        remoteContent: content,
        tags: parsed.tags,
        body: parsed.body,
      })
      continue
    }

    if (isAttachmentPath(path)) {
      const bytes = await file.async('uint8array')
      const remoteSha = await gitBlobShaBytes(bytes)
      const mime = guessMimeFromPath(path)
      classifications.push({ kind: 'attachmentCreated', path, remoteSha, mime })
      // pullFromZipball already has the bytes in memory — stash them so the
      // apply step doesn't issue a redundant per-blob fetch against the API.
      attachmentBytesByPath.set(path, { bytes, mime })
      continue
    }
  }

  return { classifications, latestCommitSha: headSha }
}

// Side-channel cache: pullFromZipball already has the bytes in memory after
// reading the zip, so we stash them here and the apply layer (or anyone
// calling getZipballAttachmentBytes) can grab them without re-downloading.
// Cleared after applyAttachmentClassifications consumes them.
const attachmentBytesByPath = new Map<string, { bytes: Uint8Array; mime: string }>()

export function takeZipballAttachmentBytes(
  path: string,
): { bytes: Uint8Array; mime: string } | null {
  const entry = attachmentBytesByPath.get(path)
  if (!entry) return null
  attachmentBytesByPath.delete(path)
  return entry
}
