// Per-repo vault snapshot cache (issue #68 — offline-first Step 1).
//
// What this stores
//   The last successful pull's identity for a given (owner, name) repo:
//     - commit SHA at the tip of the branch we synced against
//     - the recursive tree (path → blob sha)
//     - a wall-clock timestamp ("Synced 14 minutes ago")
//
// What this does NOT store
//   The note bodies themselves. Those already persist via
//   `useNoteStore` → `idbStorage` under `notesKey(repo)`. The snapshot is
//   metadata about that state, not a duplicate copy. Keeping it small
//   means a snapshot read is cheap (a few KB), so the boot path can pull
//   it before the network round-trip without slowing anything down.
//
// Why it exists
//   1. Offline boot needs to know which commit the cached notes reflect, so
//      the sidebar can render "Offline — cached at abc1234" without lying.
//   2. The next pull can compare HEAD against `snapshot.commitSha` and skip
//      reconciliation if nothing moved.
//   3. Step 2 (the offline edit queue) will lean on this entry to know what
//      a queued mutation was applied against — without an anchor commit
//      the replay logic cannot detect remote-changes-during-queue cleanly.
//
// Why a separate utility (not just another Zustand store)
//   Zustand persists one JSON blob per store; the snapshot is repo-scoped
//   and writes are infrequent (once per successful pull). A bare
//   idb-keyval entry per repo keeps the surface tiny and avoids a new
//   store with its own hydration race. It also means resets / wipes /
//   `switchVault` need zero coordination — the entry is just a key.
//
// Key shape
//   `noteser-vault-cache:<owner>/<name>` — colon-after-prefix matches the
//   `noteser-attachment:` and `noteser-ai-embedding:` conventions, so the
//   existing `reset.ts` prefix-walker over `noteser-` cleans these up on
//   a Wipe vault.

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { SyncRepo } from '@/types'

export interface VaultSnapshot {
  /** Commit SHA at the tip of the tracked branch the last time we synced. */
  commitSha: string
  /**
   * Flat (path → blob sha) for every entry in the recursive tree. Stored
   * as an array of tuples so the IDB value is JSON-stable (Maps don't
   * structured-clone friendly under every browser version we still
   * support; arrays do).
   */
  treeMap: Array<[string, string]>
  /** `Date.now()` at the moment we wrote the snapshot. */
  syncedAt: number
}

const KEY_PREFIX = 'noteser-vault-cache:'

function keyFor(repo: SyncRepo): string {
  return `${KEY_PREFIX}${repo.owner}/${repo.name}`
}

/**
 * Read the cached snapshot for `repo`. Returns null when there is no
 * entry (fresh install / never-synced repo / IDB unavailable). Never
 * throws — callers treat absence as "no cache yet" and proceed.
 */
export async function readVaultSnapshot(repo: SyncRepo): Promise<VaultSnapshot | null> {
  try {
    const v = await idbGet<VaultSnapshot>(keyFor(repo))
    if (!v) return null
    // Light shape guard. A corrupted entry (manually edited, ancient
    // schema, etc) should fall back to "no cache" rather than crash a
    // boot path.
    if (typeof v.commitSha !== 'string') return null
    if (!Array.isArray(v.treeMap)) return null
    if (typeof v.syncedAt !== 'number') return null
    return v
  } catch {
    return null
  }
}

/**
 * Write the snapshot for `repo`. Best-effort: a quota / IDB error logs
 * but does not throw — the sync still succeeded from the user's POV,
 * we just won't have an offline-boot anchor next time.
 */
export async function writeVaultSnapshot(repo: SyncRepo, snapshot: VaultSnapshot): Promise<void> {
  try {
    await idbSet(keyFor(repo), snapshot)
  } catch {
    // Quota / private-mode / racing close. Silent — see header.
  }
}

/**
 * Drop the cached snapshot for `repo`. Called from "Discard local
 * changes" and from tests. The next pull rebuilds it.
 */
export async function clearVaultSnapshot(repo: SyncRepo): Promise<void> {
  try {
    await idbDel(keyFor(repo))
  } catch {
    // Best-effort.
  }
}

/**
 * Convenience: build a snapshot from a tree Map (the shape the pull
 * layer already has). Pure — handy in tests so callers don't have to
 * tuple-flatten in three places.
 */
export function buildSnapshot(commitSha: string, treeMap: Map<string, string>): VaultSnapshot {
  return {
    commitSha,
    treeMap: Array.from(treeMap.entries()),
    syncedAt: Date.now(),
  }
}

/**
 * Public key shape, exposed for tests + the reset.ts prefix walker so
 * downstream callers don't have to re-stringify the format.
 */
export const VAULT_CACHE_KEY_PREFIX = KEY_PREFIX
