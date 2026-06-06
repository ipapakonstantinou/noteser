# Offline-first + installable PWA — plan

Scope and shape for issue #68. Step 1 (this PR) is **read-offline + installable
PWA**. Step 2 (deferred follow-up) is the **offline edit queue + reconciliation**.

Read this if you are touching `src/utils/githubSync/*`, `src/utils/idbStorage.ts`,
the service worker (`public/sw.js`), or anything that asks "where does the
vault live when the user is offline?"

## Goals

- The app boots and is fully readable with no network. The user opens noteser,
  every note they had at last sync is there, the tree, the tags, the search
  index — all of it. No spinner-of-doom on the sidebar.
- A reload while offline is indistinguishable from a normal reload (modulo a
  small "Offline — using cached vault" badge). Pull is skipped quietly; no
  red toast.
- The app is installable as a PWA (Chrome / Android / iOS-via-AddToHomeScreen).
- The cache is **per-repo**. Switching vaults swaps the cache window; never
  mixes one repo's bodies into another's.
- The cache invalidates on commit-SHA change. A successful pull reconciles the
  cache to the new HEAD; nothing else touches it.
- Step 2 (deferred): writes made while offline queue locally and replay on the
  next sync. **Not in this PR.**

## What is and is not cached (Step 1)

| Surface | Where it lives | Hydrates on boot? | Notes |
| --- | --- | --- | --- |
| Note bodies + frontmatter | `noteser-notes:<owner>/<name>` (Zustand persist → `idbStorage`) | Yes (existing) | Untouched in Step 1 — already offline-readable. |
| Folder tree | `noteser-folders:<owner>/<name>` | Yes (existing) | Same as notes. |
| Workspace (open tabs) | `noteser-workspace` | Yes (existing) | Already covered by Zustand persist. |
| Remote tree map (path → blob SHA) | `noteser:vault-cache:tree:<owner>/<name>` (new) | Cold-read for invalidation only | Per-repo. Stored as `Array<[path, sha]>` for JSON-stable serialization. |
| Last-known commit SHA | `noteser:vault-cache:head:<owner>/<name>` (new) | Cold-read on boot | Used to detect "remote moved while we were offline". |
| Vault settings file | already covered by `useSettingsStore` persist | Yes (existing) | No change. |
| Per-blob bodies | `noteser:gh-etag:blob:<owner>/<name>:<sha>` (already exists, PR #107) | Lazy | Untouched. ETag cache survives reloads, so a re-sync after coming back online sends `If-None-Match` and unchanged blobs come back as 304. |
| Recursive tree response | `noteser:gh-etag:tree:<owner>/<name>:<treeSha>` (already exists, PR #107) | Lazy | Same as above. |
| Static app shell (HTML/JS/CSS, icons, fonts) | Service worker `noteser-shell-<build>` cache | Lazy on first navigation, then cache-first | Already implemented (`public/sw.js`). |
| `/api/git-proxy/*`, `/api/github/*` | Never cached | n/a | SW bypass — auth + sync calls always hit the network. |
| OAuth token | `localStorage` under `noteser-github` | Yes (existing) | Same trust model as today. Cache survives reload, so an expired token is rediscovered on the first online sync attempt. |

### Why these keys

- The Zustand persist key (`notesKey(repo)`) is the source of truth for the
  user-visible note set. The new `noteser:vault-cache:*` keys are *metadata*
  about the last successful sync, not a copy of the data — they let the pull
  layer decide whether a re-pull is required, and they let the UI surface
  "you're viewing commit abc1234 (offline)".
- Putting them under the `noteser:` prefix (not `noteser-`) keeps them on the
  same purge path as the existing IDB caches (`noteser:gh-etag:*`,
  `noteser:attachment:*`) so a Wipe vault / reset clears them in one sweep.
- Keying by `<owner>/<name>` mirrors `notesKey()`. No vault collides with
  another, and switching vaults via `switchVault.ts` does not require manual
  cache eviction — the new repo's cache is simply absent until its first
  successful pull, exactly like its notes store.

## Per-repo SHA invalidation

The cache entry is a small JSON document:

```ts
interface VaultCacheSnapshot {
  // Commit at the tip of the tracked branch on the last successful pull.
  commitSha: string
  // (path → blob sha) flattened. Used by the offline boot path to know
  // which note bodies the local store SHOULD have, and by tests to assert
  // "we cached what we synced".
  treeMap: Array<[string, string]>
  // Wall-clock for the UI: "Synced 2 hours ago".
  syncedAt: number
}
```

Lifecycle:

1. `pullFromGitHub` (in `src/utils/githubSync/syncPull.ts`) already fetches the
   head commit + recursive tree. After a successful classification we
   `writeVaultSnapshot(repo, { commitSha, treeMap, syncedAt: Date.now() })`.
2. On boot, `vaultSnapshotKey(repo)` is read once (background). The result is
   exposed via `useVaultCacheStatus()` so the sidebar can show the cached
   commit SHA when offline.
3. Invalidation is **commit-SHA-driven**. The next pull compares the remote
   HEAD against `snapshot.commitSha`. If they match and our local Zustand
   store has every path the snapshot lists, we are confident the local view
   is consistent and can skip the whole tree walk on a quick re-check
   (Step 2 will lean on this for the optimistic-write path).
4. Explicit invalidation hooks:
   - `switchVault` does NOT clear the previous vault's snapshot — it is
     repo-scoped, so the next time we connect to that repo it is reused.
   - `reset.ts` (Wipe vault) clears every `noteser:vault-cache:*` key via the
     existing prefix-walk in `wipeNoteserState`.
   - The Discard Local Changes modal calls `clearVaultSnapshot(repo)` so the
     next pull rebuilds it from scratch.

## Offline boot path

`useAutoSync` is the only consumer that fires a startup pull. Today it calls
`runPullOnly()` unconditionally when connected + setting enabled. The offline
path adds:

```ts
// Pseudocode in useAutoSync:
if (!hydrated) return
if (!isConnected) return
if (!autoSyncOnStart) return

if (typeof navigator !== 'undefined' && navigator.onLine === false) {
  // Offline boot. Notes already hydrated from IDB via Zustand persist.
  // Surface a quiet badge ("Offline — using cached vault") and skip pull.
  setOfflineBadge(true)
  return
}

void runPullOnly()
```

Pull failures from a network-down event mid-session do **not** show a red
toast in Step 1. The fetch helpers (`githubFetch.ts`) already surface
`TypeError: Failed to fetch` on a network failure; `useGitHubSync.runPullOnly`
catches it and, when `navigator.onLine === false`, swaps the error toast for
a quiet status: "Offline — changes will sync when you reconnect."

A `window.addEventListener('online', ...)` listener in `useAutoSync` retries
the pull when connectivity returns. No exponential backoff; one shot, the
user can click Sync if it fails again.

## Service worker (already implemented — recap)

`public/sw.js` exists. Behaviour:

- `install`: pre-cache the app shell (start URL `/`, manifest, icons).
- `activate`: drop every cache that is not the current `noteser-shell-<build>`
  version. `self.clients.claim()` so updates land on open tabs.
- `fetch`:
  - `/api/*` → never intercepted (the OAuth proxy + any future API stays
    fully online).
  - Cross-origin (`api.github.com`, AI providers) → never intercepted.
  - Same-origin static assets (`/_next/static/*`, `/icons/*`, `/manifest.json`,
    fonts, css, js) → cache-first.
  - Navigations → network-first, fall back to cached `/` when offline.

Step 1 does **not** change the SW. The plan doc is the inventory.

## Step 2 (deferred follow-up, NOT in this PR)

Edit-queue semantics — the design we will land in a follow-up issue:

1. **Queue shape.** Every offline mutation that `useNoteStore` /
   `useFolderStore` issues today (`addNote`, `updateNote`, `deleteNote`,
   `addFolder`, `renameFolder`, etc.) records a journal entry in a new
   `noteser:edit-queue:<owner>/<name>` IDB key. Entry shape:

   ```ts
   interface QueuedEdit {
     id: string                  // ULID; ordering matters
     kind: 'noteUpdate' | 'noteCreate' | 'noteDelete' | 'folderCreate' | …
     noteId?: string             // for note ops
     folderId?: string           // for folder ops
     ts: number                  // wall-clock for debugging
     // The payload is the minimal patch we need to re-apply if a remote
     // pull stomps the note before sync runs. For noteUpdate this is
     // {content, updatedAt}; for noteCreate it's the whole Note minus
     // gitPath/gitLastPushedSha; etc.
     payload: unknown
   }
   ```

2. **Replay on sync.** Before `runPush`, walk the queue oldest-first.
   For each entry, apply the patch on top of the (possibly remote-updated)
   local note. Then push as today. Successful push → drop the journal
   entries up to the pushed commit.

3. **Conflict reconciliation.** If a queued `noteUpdate` collides with a
   `remoteUpdated` from the same pull, classify as `conflict` and open the
   merge editor — same UX as today. The journal entry is not dropped until
   the user resolves and the push succeeds (so a partial recovery still has
   the local edit somewhere).

4. **Tombstones.** Soft-deletes already carry `isDeleted` + `deletedAt`. The
   queue treats them as `noteUpdate` payloads. A hard-delete (Trash → Delete
   permanently) records `noteDelete` and the next sync emits a `sha: null`
   tree entry on push as today.

5. **Failure modes.**
   - Queue exceeds N MB → surface a warning toast, refuse new offline edits
     until reconciled. (N TBD; probably 10 MB.)
   - Push fails after replay → keep the queue intact, show "X edits pending,
     retry?" — the user can keep editing offline.
   - Token expired during replay → bounce to GitHubAuthModal, queue
     untouched.

6. **Tests.** Three buckets: queue-shape (in/out + ULID ordering), replay
   correctness against a synthetic remote tree, conflict reconciliation
   against the existing `syncClassify` cases.

## File map

New (this PR):

- `docs/offline-pwa-plan.md` — this file.
- `src/utils/vaultSnapshotCache.ts` — read/write the per-repo snapshot.
- `src/hooks/useVaultCacheStatus.ts` — exposes `{ snapshot, isOffline }`
  to the UI so the sidebar can render "Offline · cached at abc1234".
- `src/components/sidebar/OfflineBadge.tsx` — the badge itself.

Touched (this PR):

- `src/utils/githubSync/syncPull.ts` — call `writeVaultSnapshot()` after a
  successful classification.
- `src/hooks/useAutoSync.ts` — `navigator.onLine` short-circuit + `online`
  event listener.
- `src/hooks/useGitHubSync.ts` — quieter error path for offline failures.
- `src/utils/reset.ts` — extend the prefix list to include
  `noteser:vault-cache:`.
- `docs/sync.md` — add an "Offline" section pointing at this plan.
- `docs/user-guide.md` — short "Offline" subsection.

Untouched (intentionally):

- `public/sw.js`, `public/manifest.json`, `src/components/pwa/PwaProvider.tsx`
  — already shipped on `dev`.
- `src/utils/githubETagCache.ts` — independent of the snapshot cache.
- The push path (`syncPush.ts`) — Step 2 territory.
