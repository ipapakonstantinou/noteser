/**
 * @jest-environment node
 *
 * vaultSnapshotCache.test.ts (#68 — offline-first Step 1)
 *
 * Covers `src/utils/vaultSnapshotCache.ts`:
 *
 *   1. Round-trip — write a snapshot, read it back, the shape matches.
 *   2. Cold-read miss — reading an unwritten repo returns `null`, not a
 *      reject (boot path treats absence as "no cache yet" and proceeds).
 *   3. Per-repo keying — two repos are isolated; the wrong one stays null.
 *   4. Invalidation on SHA change — `clearVaultSnapshot` drops the entry,
 *      AND a fresh `writeVaultSnapshot` with a new commit SHA overwrites
 *      the old one (a re-pull writes the new anchor and the old SHA is
 *      no longer readable).
 *   5. Corrupt entry guard — a mangled IDB value reads as `null` instead
 *      of crashing the boot path.
 *
 * idb-keyval is mocked to an in-memory Map so the tests are deterministic
 * + don't depend on a jsdom IDB shim.
 */

import type { SyncRepo } from '@/types'

const idbBackingStore = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (k: string) => idbBackingStore.get(k)),
  set: jest.fn(async (k: string, v: unknown) => { idbBackingStore.set(k, v) }),
  del: jest.fn(async (k: string) => { idbBackingStore.delete(k) }),
}))

import {
  buildSnapshot,
  clearVaultSnapshot,
  readVaultSnapshot,
  writeVaultSnapshot,
  VAULT_CACHE_KEY_PREFIX,
} from '../utils/vaultSnapshotCache'

const REPO_A: SyncRepo = { owner: 'jon', name: 'vault-a', branch: 'main', isPrivate: false }
const REPO_B: SyncRepo = { owner: 'jon', name: 'vault-b', branch: 'main', isPrivate: false }

beforeEach(() => {
  idbBackingStore.clear()
})

test('round-trips a snapshot', async () => {
  const tree = new Map<string, string>([
    ['notes/one.md', 'sha-one'],
    ['notes/two.md', 'sha-two'],
  ])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-1', tree))
  const got = await readVaultSnapshot(REPO_A)
  expect(got).not.toBeNull()
  expect(got!.commitSha).toBe('commit-1')
  expect(got!.treeMap).toEqual([
    ['notes/one.md', 'sha-one'],
    ['notes/two.md', 'sha-two'],
  ])
  expect(typeof got!.syncedAt).toBe('number')
})

test('returns null for a never-written repo (cold boot)', async () => {
  const got = await readVaultSnapshot(REPO_A)
  expect(got).toBeNull()
})

test('keys per-repo: writing A does not leak into B', async () => {
  const tree = new Map<string, string>([['notes/x.md', 'sha-x']])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-A', tree))
  expect(await readVaultSnapshot(REPO_A)).not.toBeNull()
  expect(await readVaultSnapshot(REPO_B)).toBeNull()
})

test('invalidates on SHA change: clearVaultSnapshot drops the entry', async () => {
  const tree = new Map<string, string>([['notes/x.md', 'sha-x']])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-1', tree))
  await clearVaultSnapshot(REPO_A)
  expect(await readVaultSnapshot(REPO_A)).toBeNull()
})

test('invalidates on SHA change: a re-pull overwrites the prior commit', async () => {
  // Initial pull writes commit-1.
  const tree1 = new Map<string, string>([['notes/x.md', 'old-sha']])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-1', tree1))
  expect((await readVaultSnapshot(REPO_A))!.commitSha).toBe('commit-1')

  // Next pull (different remote SHA) overwrites.
  const tree2 = new Map<string, string>([['notes/x.md', 'new-sha']])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-2', tree2))
  const got = await readVaultSnapshot(REPO_A)
  expect(got!.commitSha).toBe('commit-2')
  expect(got!.treeMap).toEqual([['notes/x.md', 'new-sha']])
})

test('a corrupted IDB value reads as null (boot path stays robust)', async () => {
  // Hand-write a value that lacks commitSha.
  idbBackingStore.set(`${VAULT_CACHE_KEY_PREFIX}${REPO_A.owner}/${REPO_A.name}`, {
    /* missing commitSha */
    treeMap: [],
    syncedAt: 0,
  })
  expect(await readVaultSnapshot(REPO_A)).toBeNull()
})

test('uses the documented key prefix (`noteser-vault-cache:`) — so reset.ts picks it up', async () => {
  const tree = new Map<string, string>([['notes/x.md', 'sha-x']])
  await writeVaultSnapshot(REPO_A, buildSnapshot('commit-1', tree))
  // Reset's wipeNoteserState walks every IDB key starting with the
  // `noteser-` dash prefix; this assertion locks the key format so a
  // future refactor doesn't silently slip outside that walker.
  const stored = Array.from(idbBackingStore.keys())
  expect(stored).toHaveLength(1)
  expect(stored[0].startsWith(VAULT_CACHE_KEY_PREFIX)).toBe(true)
  expect(stored[0].startsWith('noteser-')).toBe(true)
})
