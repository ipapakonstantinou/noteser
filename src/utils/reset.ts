// Recovery helpers — wipe accumulated noteser state when it has drifted
// out of sync with the remote (typical symptom: every push uploads every
// blob because folder.name was stored unsanitized, or gitLastPushedSha is
// null on every note from a stale schema).
//
// Two entry points:
//   1. `?reset=1` URL flag (handled in src/app/page.tsx) for dev + an
//      escape hatch we can hand users in support situations.
//   2. PERSISTED_RESET_VERSION constant — bump it in a release to force
//      every browser to wipe local state exactly once on next visit.
//      Use sparingly: it discards any local-only changes that haven't
//      reached the remote.

import { keys, del } from 'idb-keyval'

// Bump this when you want to ship a forced one-time wipe to every user
// running an older copy. Compare against `localStorage[RESET_VERSION_KEY]`
// — mismatch = wipe. Same value = no-op.
//
// Held at 1 even though the partial-wipe path is now available — bumping
// would re-prompt every user who already escaped with `?reset=1`. Bump
// to 2 the next time we actually need a wipe; the modal + partial-wipe
// path will Just Work then.
export const PERSISTED_RESET_VERSION = 1

export const RESET_VERSION_KEY = 'noteser-reset-version'
// Storage prefix every noteser key (localStorage + IDB) shares.
const NOTESER_PREFIX = 'noteser-'

// Keys preserved by a kill-switch wipe (we DON'T want users to lose
// their GitHub session + UI preferences just because we bumped the
// reset version to recover note/folder drift).
export const PRESERVE_ON_KILLSWITCH: readonly string[] = [
  'noteser-github',       // OAuth token + connected repo
  'noteser-settings',     // user preferences (folder paths, AI keys, etc)
  'noteser-ui',           // sidebar width, view, etc
  'noteser-attachment:',  // PREFIX — every attachment blob in IDB
]

export interface WipeOpts {
  /** Keys (or key prefixes ending in `:`) to preserve. Defaults to []
   *  for a full wipe — that's the `?reset=1` escape-hatch behaviour. */
  preserve?: readonly string[]
}

// Wipes noteser-owned keys in localStorage AND idb-keyval. The `preserve`
// list lets the kill-switch path keep GitHub creds + settings while
// dropping notes/folders/workspace state. Caller is responsible for
// reloading the page — we don't reload from here so tests can assert.
export async function wipeNoteserState(opts: WipeOpts = {}): Promise<void> {
  const preserve = opts.preserve ?? []
  const shouldPreserve = (key: string): boolean => {
    for (const p of preserve) {
      if (p.endsWith(':')) {
        if (key.startsWith(p)) return true
      } else if (key === p) {
        return true
      }
    }
    return false
  }

  if (typeof localStorage !== 'undefined') {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(NOTESER_PREFIX) && !shouldPreserve(k)) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  }

  try {
    const all = await keys()
    const targets = all.filter((k): k is string =>
      typeof k === 'string'
        && k.startsWith(NOTESER_PREFIX)
        && !shouldPreserve(k),
    )
    await Promise.all(targets.map(k => del(k)))
  } catch {
    // No IDB available (jsdom without a shim). Local-storage wipe is the
    // recovery path in that env anyway.
  }
}

// Returns true if any active note carries an `updatedAt` newer than the
// last successful GitHub sync. Used to gate the kill-switch wipe so we
// don't silently destroy local-only work.
//
// Pure function — takes the bits it needs as args so it's trivially
// testable without dragging the whole store graph into the test.
export function hasUnsyncedChanges(
  notes: Array<{ updatedAt: number; isDeleted?: boolean }>,
  lastSyncedAt: number | null,
): boolean {
  if (lastSyncedAt == null) {
    // No sync ever happened — every active note is "unsynced" by definition.
    return notes.some(n => !n.isDeleted)
  }
  return notes.some(n => !n.isDeleted && n.updatedAt > lastSyncedAt)
}

// Browser-side: read the `?reset=1` query param. Pulled into its own
// helper so the page-mount effect can stay tiny + so tests can stub it.
export function isResetRequestedFromURL(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('reset') === '1'
  } catch {
    return false
  }
}

// Read the stored reset version (returns null when never set). Exposed so
// tests can assert the version-key bookkeeping without touching window.
export function readStoredResetVersion(): number | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(RESET_VERSION_KEY)
  if (raw == null) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

// Write the current reset version. Always written AFTER a wipe so we don't
// re-trigger on the next reload.
export function writeStoredResetVersion(version: number = PERSISTED_RESET_VERSION): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(RESET_VERSION_KEY, String(version))
}

// Decision helper for the kill-switch check. Returns one of:
//   { action: 'noop' }       — version matches, do nothing
//   { action: 'markOnly' }   — fresh install (no notes, never synced): just
//                              persist the version, no wipe + no reload
//   { action: 'wipe' }       — version mismatch + persisted state worth
//                              wiping, no unsynced work
//   { action: 'confirm' }    — version mismatch + unsynced work, ask user
//
// `markOnly` is what stops a first-time visitor from hitting a redundant
// wipe + reload — without it, every fresh browser triggered an immediate
// reload on mount which broke E2E tests AND created a visible flash for
// new users.
export function decideResetAction(input: {
  storedVersion: number | null
  currentVersion: number
  notes: Array<{ updatedAt: number; isDeleted?: boolean }>
  lastSyncedAt: number | null
}): { action: 'noop' | 'markOnly' | 'wipe' | 'confirm' } {
  if (input.storedVersion === input.currentVersion) return { action: 'noop' }
  const activeNotes = input.notes.filter(n => !n.isDeleted)
  // Fresh install: nothing in the store, never synced. Just stamp the
  // version forward so subsequent loads are no-ops; no wipe / no reload.
  if (activeNotes.length === 0 && input.lastSyncedAt == null) {
    return { action: 'markOnly' }
  }
  if (hasUnsyncedChanges(input.notes, input.lastSyncedAt)) {
    return { action: 'confirm' }
  }
  return { action: 'wipe' }
}
