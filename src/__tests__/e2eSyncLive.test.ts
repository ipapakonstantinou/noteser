/**
 * @jest-environment node
 *
 * e2eSyncLive.test.ts
 *
 * END-TO-END harness that drives noteser's REAL GitHub sync code
 * (`pullFromGitHub` / `syncToGitHub`) against a LIVE GitHub test repo.
 *
 * Unlike githubSyncRoundtrip.test.ts (which mocks the github.ts network
 * surface and serves canned blobs), this test makes REAL calls to
 * api.github.com. It only runs when `GITHUB_TEST_TOKEN` is present in the
 * environment — otherwise every test self-skips, so the normal `npm test`
 * suite is unaffected and stays green.
 *
 * Run it with the token loaded:
 *   npm run e2e:sync
 * which sources ~/.config/noteser/test-token.env and runs only this file.
 *
 * SAFETY: the harness NEVER touches `main`. It operates on a dedicated
 * `claude-harness` branch which it creates fresh from main's current commit
 * at the start of the run (delete + recreate) and deletes at the end. The
 * token value is read at runtime and never logged.
 *
 * What it asserts (each scenario logged with a [scenario] tag):
 *   1. Baseline pull with empty local state.
 *   2. Push 3 new notes  → created === 3 + commitSha returned.
 *   2b. PROGRESSIVE CLONE: pull with EMPTY local state and isFirstClone=true →
 *       all 3 pushed notes come back as SHELLS (remoteCreated, shell:true,
 *       EMPTY remoteContent — NO body fetched), and fetchZipball (the Vercel
 *       proxy path) is NOT called.
 *   2c. SHELL SAFETY: apply the shells (content '', contentLoaded false),
 *       confirm a re-pull classifies them `unchanged` WITHOUT fetching bodies,
 *       and confirm syncToGitHub produces NO push for the unfilled shells
 *       (no empty-body overwrite). Then simulate the background fill (set the
 *       real body + contentLoaded true) and confirm a re-pull still reads
 *       `unchanged` — normal behaviour resumes.
 *   3. Re-pull with those 3 notes as local state → all `unchanged`
 *      (regression guard for the misclassification bug).
 *   4. Empty-commit guard: re-push unchanged notes → unchanged === true
 *      AND branch head sha is byte-identical before/after (no empty commit).
 *   5. Update one note → updated === 1 + a new commit exists.
 *   6. PUSH-ONLY-REAL-EDITS (churn fix): plant a NON-CANONICAL remote blob
 *      (body with NO trailing newline) via the Git Data API, clone it so the
 *      local note's gitLastPushedSha = canonical / gitRemoteBaseSha = raw
 *      non-canonical sha, then assert syncToGitHub with the note UNCHANGED does
 *      NOTHING (unchanged === true, branch head sha byte-identical, no blob, no
 *      commit). Then edit the body and assert it DOES push (updated === 1, new
 *      commit). Proves a non-canonical clone never churns yet real edits sync.
 */

// ── Mocks (mirror githubSyncRoundtrip.test.ts) ──────────────────────────────
// idb-keyval is backed by an in-memory Map so the Zustand persist layer and
// attachments.ts have somewhere to write under Node. We keep github.ts REAL
// (no mock) — that's the whole point: the network calls go to GitHub.
jest.mock('idb-keyval', () => {
  const store = new Map<IDBValidKey, unknown>()
  return {
    get: jest.fn(async (key: IDBValidKey) => store.get(key)),
    set: jest.fn(async (key: IDBValidKey, val: unknown) => { store.set(key, val) }),
    del: jest.fn(async (key: IDBValidKey) => { store.delete(key) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    clear: jest.fn(async () => { store.clear() }),
  }
})

// Attachments: text notes only in this harness — stub the binary surface so
// listAttachmentPaths()/tombstones resolve to empty and the push/pull paths
// never reach FileReader (blobToBase64), which has no Node implementation.
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: async () => undefined,
}))

import { webcrypto } from 'node:crypto'
import { TextEncoder, TextDecoder } from 'node:util'

// ── Polyfills for the Node test env ─────────────────────────────────────────
// github.ts uses crypto.subtle (WebCrypto) for gitBlobSha and TextEncoder/
// TextDecoder for the blob byte work. jsdom would provide these; the node env
// may not, so install them if missing.
const g = globalThis as unknown as {
  crypto?: Crypto
  TextEncoder?: typeof TextEncoder
  TextDecoder?: typeof TextDecoder
}
if (typeof g.crypto === 'undefined' || !g.crypto.subtle) {
  g.crypto = webcrypto as unknown as Crypto
}
if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = TextEncoder
}
if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = TextDecoder
}

import { pullFromGitHub, syncToGitHub, serializeNote, parseNote } from '../utils/githubSync'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  createBlob,
  createTree,
  createCommit,
  updateBranchRef,
  gitBlobSha,
} from '../utils/github'
import { githubFetch } from '../utils/githubFetch'
import type { Note, SyncRepo } from '@/types'

const TOKEN = process.env.GITHUB_TEST_TOKEN
const OWNER = 'ipapakonstantinou'
const REPO_NAME = 'noteser-vault'
const BASE_BRANCH = 'main'
const HARNESS_BRANCH = 'claude-harness'

const repo: SyncRepo = { owner: OWNER, name: REPO_NAME, branch: HARNESS_BRANCH, isPrivate: false }

const GH_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

// ── Raw Git Data API helpers for branch-ref lifecycle ───────────────────────
// github.ts has no create/delete-ref helpers (the app only ever fast-forwards
// an existing branch), so the harness drives the ref endpoints directly.

async function getRefSha(branch: string): Promise<string> {
  // Reuse the app's getBranchRefSha so we exercise the same read path.
  return getBranchRefSha(TOKEN!, OWNER, REPO_NAME, branch)
}

async function deleteRef(branch: string): Promise<void> {
  const res = await githubFetch(
    `https://api.github.com/repos/${OWNER}/${REPO_NAME}/git/refs/heads/${branch}`,
    { method: 'DELETE', headers: GH_HEADERS },
  )
  // 204 = deleted, 422 = didn't exist. Anything else is a real failure.
  if (res.status !== 204 && res.status !== 422) {
    throw new Error(`deleteRef(${branch}) failed (${res.status})`)
  }
}

async function createRef(branch: string, sha: string): Promise<void> {
  const res = await githubFetch(
    `https://api.github.com/repos/${OWNER}/${REPO_NAME}/git/refs`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    },
  )
  if (!res.ok) throw new Error(`createRef(${branch}) failed (${res.status})`)
}

/** Delete then recreate `claude-harness` at main's current head. Reproducible. */
async function resetHarnessBranch(): Promise<string> {
  const mainSha = await getRefSha(BASE_BRANCH)
  await deleteRef(HARNESS_BRANCH)
  await createRef(HARNESS_BRANCH, mainSha)
  return mainSha
}

// ── Local note factory ──────────────────────────────────────────────────────
function makeNote(title: string, content: string): Note {
  const now = Date.now()
  return {
    id: `${title}-id`,
    title,
    content,
    folderId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    gitRemoteBaseSha: null,
  }
}

/** Apply syncToGitHub's pathUpdates onto local notes, mirroring the store. */
function applyPathUpdates(notes: Note[], updates: { noteId: string; gitPath: string | null; gitLastPushedSha: string | null; gitRemoteBaseSha: string | null }[]): Note[] {
  const byId = new Map(updates.map(u => [u.noteId, u]))
  return notes.map(n => {
    const u = byId.get(n.id)
    if (!u) return n
    return { ...n, gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha, gitRemoteBaseSha: u.gitRemoteBaseSha }
  })
}

// Write `content` to `path` on the harness branch via the Git Data API
// directly (NOT through syncToGitHub), so we can plant a NON-CANONICAL remote
// blob (e.g. a body with no trailing newline) that noteser itself would never
// produce. Returns the raw remote blob SHA GitHub stored.
async function writeRemoteFileRaw(path: string, content: string): Promise<string> {
  const parentCommit = await getBranchRefSha(TOKEN!, OWNER, REPO_NAME, HARNESS_BRANCH)
  const baseTreeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, parentCommit)
  const blobSha = await createBlob(TOKEN!, OWNER, REPO_NAME, content)
  const treeSha = await createTree(TOKEN!, OWNER, REPO_NAME, baseTreeSha, [
    { path, mode: '100644', type: 'blob', sha: blobSha },
  ])
  const { sha: commitSha } = await createCommit(
    TOKEN!, OWNER, REPO_NAME, `harness: plant non-canonical ${path}`, treeSha, parentCommit,
  )
  await updateBranchRef(TOKEN!, OWNER, REPO_NAME, HARNESS_BRANCH, commitSha)
  return blobSha
}

// rename-not-delete harness helper: RENAME remote files in a SINGLE commit
// WITHOUT losing content — for each {from,to} the new-path blob reuses the
// existing blob SHA at `from` (so the content is preserved exactly) and the
// old path is removed (sha:null). This simulates the dash→space form change
// the user did when they reverted their remote vault: the same content now
// lives under a new name. Returns the new commit SHA.
async function renameRemoteFiles(renames: Array<{ from: string; to: string }>): Promise<string> {
  const parentCommit = await getBranchRefSha(TOKEN!, OWNER, REPO_NAME, HARNESS_BRANCH)
  const baseTreeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, parentCommit)
  const tree = await getTreeMap(TOKEN!, OWNER, REPO_NAME, baseTreeSha)
  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
  for (const { from, to } of renames) {
    const blobSha = tree.get(from)
    if (!blobSha) throw new Error(`renameRemoteFiles: source path missing in tree: ${from}`)
    // Add the content under the NEW path (reusing the exact blob SHA — content
    // is preserved), and DELETE the old path. Both in the same tree → one commit.
    entries.push({ path: to, mode: '100644', type: 'blob', sha: blobSha })
    entries.push({ path: from, mode: '100644', type: 'blob', sha: null })
  }
  const treeSha = await createTree(TOKEN!, OWNER, REPO_NAME, baseTreeSha, entries)
  const { sha: commitSha } = await createCommit(
    TOKEN!, OWNER, REPO_NAME, 'harness: rename files (content preserved)', treeSha, parentCommit,
  )
  await updateBranchRef(TOKEN!, OWNER, REPO_NAME, HARNESS_BRANCH, commitSha)
  return commitSha
}

// Mirror syncApply.canonicalLocalSha — the SHA of the canonical serialization
// of the stored body. This is what gitLastPushedSha is pinned to on clone.
function canonicalLocalSha(content: string): Promise<string> {
  return gitBlobSha(serializeNote({ content } as Note))
}

const log = (msg: string) => console.log(`  ${msg}`)

const maybe = TOKEN ? describe : describe.skip

maybe('e2e GitHub sync (live)', () => {
  // Live API calls + retries — give the whole suite a generous bound. Each
  // individual test still completes in seconds normally.
  jest.setTimeout(120_000)

  const stamp = Date.now()
  // Titles contain SPACES on purpose, to prove sanitizeFilename preserves them
  // through the push/pull round-trip (no space-to-dash mangling) and that a
  // spaced path still classifies `unchanged` (no re-upload churn).
  const titles = [1, 2, 3].map(i => `harness ${stamp} note ${i}`)
  // Notes carry their git linkage forward across scenarios.
  let notes: Note[] = titles.map((t, i) => makeNote(t, `Note ${i + 1} body for ${t}\n`))
  let baselineHeadSha = ''

  afterAll(async () => {
    // Scenario 6: cleanup — best-effort delete of the harness branch.
    if (!TOKEN) return
    try {
      await deleteRef(HARNESS_BRANCH)
      log(`[cleanup] deleted branch ${HARNESS_BRANCH}`)
    } catch (err) {
      log(`[cleanup] branch delete failed (ignored): ${(err as Error).message}`)
    }
  })

  test('scenario 1: reset claude-harness + baseline pull with empty local state', async () => {
    baselineHeadSha = await resetHarnessBranch()
    expect(baselineHeadSha).toMatch(/^[0-9a-f]{40}$/)
    log(`[scenario 1] reset ${HARNESS_BRANCH} to main @ ${baselineHeadSha.slice(0, 8)}`)

    const pull = await pullFromGitHub({ token: TOKEN!, repo, notes: [], folders: [] })
    // With empty local state every remote .md classifies remoteCreated; there
    // must be no spurious local-side entries (remoteDeleted/conflict).
    const kinds = pull.classifications.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1
      return acc
    }, {})
    expect(pull.latestCommitSha).toBe(baselineHeadSha)
    expect(kinds['remoteDeleted'] ?? 0).toBe(0)
    expect(kinds['conflict'] ?? 0).toBe(0)
    log(`[scenario 1] baseline pull classifications: ${JSON.stringify(kinds)} (latestCommitSha ${pull.latestCommitSha.slice(0, 8)})`)
  })

  test('scenario 2: push 3 new notes → created === 3 + commitSha returned', async () => {
    const before = await getRefSha(HARNESS_BRANCH)
    const outcome = await syncToGitHub({ token: TOKEN!, repo, notes, folders: [] })

    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.created).toBe(3)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(outcome.result.commitSha).not.toBe(before)
    // Confirm the branch head actually moved to the new commit.
    const after = await getRefSha(HARNESS_BRANCH)
    expect(after).toBe(outcome.result.commitSha)

    // Persist git linkage onto local notes for the round-trip scenarios.
    notes = applyPathUpdates(notes, outcome.pathUpdates)
    expect(notes.every(n => n.gitPath && n.gitLastPushedSha)).toBe(true)
    log(`[scenario 2] pushed 3 notes: created=${outcome.result.created} commit=${outcome.result.commitSha.slice(0, 8)} (head ${before.slice(0, 8)} → ${after.slice(0, 8)})`)
  })

  // progressive-clone: shells captured from scenario 2b so 2c can apply them.
  // Each carries the remote path + raw remote blob SHA (the only inputs the
  // shell representation needs); body stays empty until a fill.
  let shellSeeds: Array<{ path: string; remoteSha: string }> = []

  test('scenario 2b: PROGRESSIVE CLONE — pull with EMPTY local state + isFirstClone → all 3 SHELLS (empty body), no zipball', async () => {
    // Guard against the Vercel proxy path WITHOUT mocking github.ts (we keep it
    // real here). fetchZipball is the ONLY caller of the `/api/github/zipball`
    // proxy route, and it goes through the global fetch like every other GitHub
    // call. We also use this fetch wrapper to count BLOB reads — a progressive
    // clone must fetch ZERO note blobs (the whole point: bodies stream later).
    const realFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      requestedUrls.push(url)
      return realFetch(input as Parameters<typeof realFetch>[0], init)
    }) as typeof fetch

    let pull: Awaited<ReturnType<typeof pullFromGitHub>>
    try {
      // Mirror the production dispatch: a true first clone passes EMPTY local
      // state and isFirstClone=true, which now emits SHELLS (no body fetch).
      pull = await pullFromGitHub({
        token: TOKEN!,
        repo,
        notes: [],
        folders: [],
        isFirstClone: true,
      })
    } finally {
      globalThis.fetch = realFetch
    }

    // (c) The Vercel/zipball path was NOT touched.
    const zipballHits = requestedUrls.filter(u => u.includes('zipball'))
    expect(zipballHits).toEqual([])

    // (a) Each note we pushed in scenario 2 comes back classified remoteCreated
    //     as a SHELL (shell:true) with an EMPTY body.
    const pushedPaths = new Set(notes.map(n => n.gitPath))
    const created = pull.classifications.filter(
      (c): c is Extract<typeof c, { kind: 'remoteCreated' }> =>
        c.kind === 'remoteCreated' && pushedPaths.has((c as { path: string }).path),
    )
    expect(created).toHaveLength(3)
    for (const c of created) {
      expect((c as { shell?: boolean }).shell).toBe(true)
      expect(c.remoteContent).toBe('')
      expect(c.body).toBe('')
      expect(c.remoteSha).toMatch(/^[0-9a-f]{40}$/)
    }

    // (b) NO note blob (git/blobs/<sha>) was fetched during the clone pull.
    const blobReads = requestedUrls.filter(u => /\/git\/blobs\//.test(u))
    expect(blobReads).toEqual([])

    // Stash the seeds for scenario 2c.
    shellSeeds = created.map(c => ({ path: c.path, remoteSha: c.remoteSha }))

    log(`[scenario 2b] progressive clone: ${created.length} SHELLS (empty body, shell:true), 0 zipball + 0 blob reads (of ${requestedUrls.length} fetches)`)
  })

  test('scenario 2c: SHELL SAFETY — shells classify unchanged + never push; fill resumes normal behaviour', async () => {
    expect(shellSeeds.length).toBe(3)

    // Build local SHELL notes the way applyNonConflicts would: content '',
    // contentLoaded false, BOTH SHAs pinned to the raw remote blob SHA.
    let shells: Note[] = shellSeeds.map((s, i) => {
      const title = s.path.endsWith('.md') ? s.path.slice(0, -3) : s.path
      return {
        ...makeNote(title, ''),
        id: `shell-${i}`,
        content: '',
        contentLoaded: false,
        gitPath: s.path,
        gitLastPushedSha: s.remoteSha,
        gitRemoteBaseSha: s.remoteSha,
      }
    })

    // (a) Re-pull with shells as local state → all `unchanged`, and NO note
    //     blob is fetched (the classifier guard short-circuits before any body
    //     work). Wrap fetch to prove zero blob reads.
    const realFetch = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      urls.push(url)
      return realFetch(input as Parameters<typeof realFetch>[0], init)
    }) as typeof fetch
    let pull: Awaited<ReturnType<typeof pullFromGitHub>>
    try {
      pull = await pullFromGitHub({ token: TOKEN!, repo, notes: shells, folders: [] })
    } finally {
      globalThis.fetch = realFetch
    }
    const shellIds = new Set(shells.map(n => n.id))
    const mine = pull.classifications.filter(
      c => 'noteId' in c && shellIds.has((c as { noteId: string }).noteId),
    )
    expect(mine).toHaveLength(3)
    for (const c of mine) expect(c.kind).toBe('unchanged')
    // The classifier guard short-circuits BEFORE any blob fetch for OUR shells.
    // (The repo may hold OTHER notes whose blobs an incremental pull legitimately
    // reads — we only assert NONE of the shells' own remote SHAs were fetched,
    // which is what the empty-body-overwrite hazard hinges on.)
    const shellShas = new Set(shells.map(n => n.gitRemoteBaseSha!))
    const shellBlobReads = urls.filter(u => {
      const m = u.match(/\/git\/blobs\/([0-9a-f]{40})/)
      return m && shellShas.has(m[1])
    })
    expect(shellBlobReads).toEqual([])

    // (b) syncToGitHub with ONLY shells → NO push (no empty-body overwrite,
    //     no delete of the real remote file). Head sha unchanged.
    const headBefore = await getRefSha(HARNESS_BRANCH)
    const dry = await syncToGitHub({ token: TOKEN!, repo, notes: shells, folders: [] })
    expect(dry.result.unchanged).toBe(true)
    expect(dry.result.created).toBe(0)
    expect(dry.result.updated).toBe(0)
    expect(dry.result.deleted).toBe(0)
    // No shell got a gitPath:null (delete) path update.
    expect(dry.pathUpdates.find(u => shellIds.has(u.noteId) && u.gitPath === null)).toBeUndefined()
    const headAfter = await getRefSha(HARNESS_BRANCH)
    expect(headAfter).toBe(headBefore)

    // (c) Simulate the background fill: fetch each shell's REAL body and patch
    //     it in (content + canonical SHA + contentLoaded true), exactly as
    //     backgroundFill.loadOneShell does.
    const { getBlobContent } = await import('../utils/github')
    const { gitBlobSha } = await import('../utils/github')
    const { serializeNote, parseNote } = await import('../utils/githubSync')
    shells = await Promise.all(shells.map(async (n) => {
      const raw = await getBlobContent(TOKEN!, OWNER, REPO_NAME, n.gitRemoteBaseSha!)
      const body = parseNote(raw).body
      const canonical = await gitBlobSha(serializeNote({ content: body } as Note))
      return { ...n, content: body, contentLoaded: true, gitLastPushedSha: canonical }
    }))
    expect(shells.every(n => n.contentLoaded === true && n.content.length > 0)).toBe(true)

    // (d) After fill, a re-pull still reads `unchanged` — normal behaviour
    //     resumed, no phantom local edit, no re-upload churn.
    const pull2 = await pullFromGitHub({ token: TOKEN!, repo, notes: shells, folders: [] })
    const mine2 = pull2.classifications.filter(
      c => 'noteId' in c && shellIds.has((c as { noteId: string }).noteId),
    )
    expect(mine2).toHaveLength(3)
    for (const c of mine2) expect(c.kind).toBe('unchanged')

    log(`[scenario 2c] shell safety: 3 shells classified unchanged (0 blob reads), syncToGitHub made NO push (head ${headBefore.slice(0, 8)} unchanged); after fill, re-pull still unchanged`)
  })

  test('scenario 3: re-pull with the 3 notes as local state → all unchanged (no misclassification)', async () => {
    const pull = await pullFromGitHub({ token: TOKEN!, repo, notes, folders: [] })

    // The 3 pushed notes must each classify `unchanged`. None may surface as
    // remoteCreated (the duplicate/twin bug) or remoteUpdated/conflict.
    const ourIds = new Set(notes.map(n => n.id))
    const ourClassifications = pull.classifications.filter(
      c => 'noteId' in c && ourIds.has((c as { noteId: string }).noteId),
    )
    expect(ourClassifications).toHaveLength(3)
    for (const c of ourClassifications) {
      expect(c.kind).toBe('unchanged')
    }
    // And no remoteCreated entry should match one of our note paths.
    const ourPaths = new Set(notes.map(n => n.gitPath))
    const stray = pull.classifications.find(
      c => c.kind === 'remoteCreated' && ourPaths.has((c as { path: string }).path),
    )
    expect(stray).toBeUndefined()
    // Spaces in the title survived as spaces in the git path (no space-to-dash
    // mangling), AND they still classified `unchanged` above — proving the
    // round-trip is stable for spaced filenames.
    expect(notes.every(n => n.gitPath?.includes(' '))).toBe(true)
    log(`[scenario 3] re-pull: all 3 notes (spaced titles) classified unchanged, paths kept spaces, no duplicate remoteCreated`)
  })

  test('scenario 4: empty-commit guard — re-push unchanged notes makes no new commit', async () => {
    const before = await getRefSha(HARNESS_BRANCH)
    const outcome = await syncToGitHub({ token: TOKEN!, repo, notes, folders: [] })

    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    // commitSha should be the existing parent (no new commit created).
    expect(outcome.result.commitSha).toBe(before)

    const after = await getRefSha(HARNESS_BRANCH)
    expect(after).toBe(before)
    log(`[scenario 4] re-push unchanged: unchanged=${outcome.result.unchanged}, head unchanged @ ${after.slice(0, 8)} (no empty commit)`)
  })

  test('scenario 5: update one note → updated === 1 + a new commit exists', async () => {
    const before = await getRefSha(HARNESS_BRANCH)
    // Edit the first note's content (and bump updatedAt to mirror a real edit).
    notes = notes.map((n, i) =>
      i === 0 ? { ...n, content: `${n.content}edited at ${Date.now()}\n`, updatedAt: Date.now() } : n,
    )

    const outcome = await syncToGitHub({ token: TOKEN!, repo, notes, folders: [] })
    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.updated).toBe(1)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(outcome.result.commitSha).not.toBe(before)

    const after = await getRefSha(HARNESS_BRANCH)
    expect(after).toBe(outcome.result.commitSha)
    expect(after).not.toBe(before)

    notes = applyPathUpdates(notes, outcome.pathUpdates)
    log(`[scenario 5] updated 1 note: updated=${outcome.result.updated} new commit=${outcome.result.commitSha.slice(0, 8)} (head ${before.slice(0, 8)} → ${after.slice(0, 8)})`)
  })

  // push-only-real-edits: THE CHURN FIX. A remote file in a NON-CANONICAL shape
  // (body with NO trailing newline — exactly what a freshly-imported Obsidian
  // vault looks like) must NOT be re-uploaded just because its raw blob SHA
  // differs from our canonical serialization. Only a GENUINE local edit pushes.
  test('scenario 6: non-canonical remote clone causes ZERO pushes; a real edit still pushes', async () => {
    const nonCanonPath = `harness ${stamp} noncanon.md`
    // (1) Plant a NON-CANONICAL remote blob: body with NO trailing newline.
    const nonCanonicalBody = `Non-canonical body for ${stamp} (no trailing newline)`
    const remoteSha = await writeRemoteFileRaw(nonCanonPath, nonCanonicalBody)
    expect(remoteSha).toMatch(/^[0-9a-f]{40}$/)

    // (2) Clone it: pull (incremental, fetches the body) → build the local note
    //     the way applyNonConflicts would. gitLastPushedSha = CANONICAL sha,
    //     gitRemoteBaseSha = the RAW non-canonical remote sha. Critically the
    //     canonical sha differs from the remote sha (the churn trigger).
    const pull = await pullFromGitHub({ token: TOKEN!, repo, notes: [], folders: [] })
    const created = pull.classifications.find(
      (c): c is Extract<typeof c, { kind: 'remoteCreated' }> =>
        c.kind === 'remoteCreated' && (c as { path: string }).path === nonCanonPath,
    )
    expect(created).toBeDefined()
    expect(created!.remoteSha).toBe(remoteSha)
    const body = parseNote(created!.remoteContent).body
    const canonicalSha = await canonicalLocalSha(body)
    expect(canonicalSha).not.toBe(remoteSha) // the non-canonical mismatch is real

    let cloned: Note = {
      ...makeNote(nonCanonPath.slice(0, -3), body),
      id: `noncanon-${stamp}`,
      gitPath: nonCanonPath,
      gitLastPushedSha: canonicalSha,
      gitRemoteBaseSha: remoteSha,
    }

    // (3) syncToGitHub with the note UNCHANGED → NO push, NO commit, NO blob.
    //     This is the churn fix: a non-canonical clone produces zero rewrites.
    const headBefore = await getRefSha(HARNESS_BRANCH)
    const dry = await syncToGitHub({ token: TOKEN!, repo, notes: [cloned], folders: [] })
    expect(dry.result.unchanged).toBe(true)
    expect(dry.result.created).toBe(0)
    expect(dry.result.updated).toBe(0)
    expect(dry.result.deleted).toBe(0)
    // No spurious pathUpdate that would rewrite the baseline on the next pull.
    expect(dry.pathUpdates.find(u => u.noteId === cloned.id)).toBeUndefined()
    const headAfterDry = await getRefSha(HARNESS_BRANCH)
    expect(headAfterDry).toBe(headBefore) // branch head UNCHANGED — no commit
    log(`[scenario 6a] non-canonical clone: syncToGitHub made NO push (head ${headBefore.slice(0, 8)} unchanged, remoteSha ${remoteSha.slice(0, 8)} !== canonical ${canonicalSha.slice(0, 8)})`)

    // (4) Now make a REAL edit → it MUST push (updated === 1, new commit).
    cloned = { ...cloned, content: `${body}\nedited at ${Date.now()}\n`, updatedAt: Date.now() }
    const wet = await syncToGitHub({ token: TOKEN!, repo, notes: [cloned], folders: [] })
    expect(wet.result.unchanged).toBe(false)
    expect(wet.result.updated).toBe(1)
    expect(wet.result.created).toBe(0)
    expect(wet.result.deleted).toBe(0)
    expect(wet.result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(wet.result.commitSha).not.toBe(headBefore)
    const headAfterEdit = await getRefSha(HARNESS_BRANCH)
    expect(headAfterEdit).toBe(wet.result.commitSha)
    expect(headAfterEdit).not.toBe(headBefore)
    log(`[scenario 6b] real edit: pushed updated=${wet.result.updated} new commit=${wet.result.commitSha.slice(0, 8)} (head ${headBefore.slice(0, 8)} → ${headAfterEdit.slice(0, 8)})`)
  })

  // ── rename-not-delete: THE DATA-LOSS FIX ──────────────────────────────────
  // Reproduces the catastrophe end-to-end: the user's remote vault was reverted
  // to a DIFFERENT filename FORM than the notes' stored gitPaths. A pull used to
  // read each renamed file as "old-path note deleted + new-path note created",
  // soft-delete the note, then DELETE the real remote file on the next push.
  //
  // We push fresh notes, RENAME each remote file (content preserved, old path
  // removed) directly via the Git Data API, then re-pull with the ORIGINAL local
  // notes (stale gitPaths). The fix must ADOPT each note to its new path (never
  // remoteDeleted), and the subsequent push must emit ZERO deletions.
  test('scenario 7: remote rename (form change) is ADOPTED, never deleted', async () => {
    // (1) Push a fresh batch so local notes carry gitPath + gitLastPushedSha.
    const rStamp = Date.now()
    let renNotes: Note[] = [1, 2, 3].map(i =>
      makeNote(`rename ${rStamp} note ${i}`, `Rename scenario body ${i} for ${rStamp}\n`),
    )
    const pushOut = await syncToGitHub({ token: TOKEN!, repo, notes: renNotes, folders: [] })
    expect(pushOut.result.created).toBe(3)
    renNotes = applyPathUpdates(renNotes, pushOut.pathUpdates)
    expect(renNotes.every(n => n.gitPath && n.gitLastPushedSha)).toBe(true)
    // Snapshot the original (pre-rename) gitPaths — the SPACE-form paths the
    // notes were just pushed to. These become STALE after the remote rename.
    const spaceFormPaths = renNotes.map(n => n.gitPath!) as string[]

    // (2) RENAME each remote file: move the content to a DASH-form name (spaces →
    //     dashes) and remove the SPACE-form path, in ONE commit. Content is
    //     preserved (same blob SHA under the new name). This mirrors the real
    //     catastrophe's precondition: the on-disk filename FORM no longer matches
    //     what the notes recorded — the only difference being how spaces render.
    const renames = spaceFormPaths.map(p => ({ from: p, to: p.replace(/ /g, '-') }))
    const renameCommit = await renameRemoteFiles(renames)
    expect(renameCommit).toMatch(/^[0-9a-f]{40}$/)
    log(`[scenario 7] renamed ${renames.length} remote files space→dash (content preserved) @ ${renameCommit.slice(0, 8)}`)

    // (2b) Make the notes match the real bug shape: their stored gitPath is now
    //      STALE (the space-form file is gone), and their TITLE is the dash-form
    //      so notePath() resolves to the dash-form remote file (the user reverted
    //      the on-disk names to a form the title produces). Content is untouched.
    const byOldPath = new Map(renames.map(r => [r.from, r.to]))
    renNotes = renNotes.map(n => {
      const dashPath = byOldPath.get(n.gitPath!)!
      // Title := dash-form filename (sans .md) so notePath(n) === dashPath, but
      // the recorded gitPath stays the now-absent SPACE-form path (stale).
      return { ...n, title: dashPath.slice(0, -3) }
    })

    // (3) Re-pull with these notes (stale space-form gitPath, dash-form title).
    //     The fix must ADOPT each note to the dash-form remote file, NEVER
    //     classify it remoteDeleted (the soft-delete that precedes the wipe).
    const pull = await pullFromGitHub({ token: TOKEN!, repo, notes: renNotes, folders: [] })
    const ourIds = new Set(renNotes.map(n => n.id))
    const ours = pull.classifications.filter(
      c => 'noteId' in c && ourIds.has((c as { noteId: string }).noteId),
    )
    expect(ours).toHaveLength(3)
    const dashPaths = new Set(renames.map(r => r.to))
    for (const c of ours) {
      // NONE may be remoteDeleted / conflictDeleted — that is the data-loss path.
      expect(c.kind).not.toBe('remoteDeleted')
      expect(c.kind).not.toBe('conflictDeleted')
      // Each must be an ADOPT: unchanged (content identical) carrying an
      // adoptPath pointing at the renamed (dash-form) remote file.
      expect(c.kind).toBe('unchanged')
      const adoptPath = (c as { adoptPath?: string }).adoptPath
      expect(adoptPath).toBeDefined()
      expect(dashPaths.has(adoptPath!)).toBe(true)
    }
    // And NO remoteCreated should appear for the renamed paths — that would be
    // the "twin note" half of the bug.
    const stray = pull.classifications.find(
      c => c.kind === 'remoteCreated' && dashPaths.has((c as { path: string }).path),
    )
    expect(stray).toBeUndefined()
    log(`[scenario 7] re-pull: all 3 notes ADOPTED to renamed paths (unchanged + adoptPath), 0 remoteDeleted, 0 twin remoteCreated`)

    // (3b) Apply the adoption to local notes (gitPath := adoptPath), as syncApply
    //      would. The notes now point at their renamed (dash-form) remote files.
    const adoptById = new Map(
      ours
        .filter(c => (c as { adoptPath?: string }).adoptPath)
        .map(c => [(c as { noteId: string }).noteId, (c as { adoptPath: string }).adoptPath]),
    )
    renNotes = renNotes.map(n => {
      const ap = adoptById.get(n.id)
      return ap ? { ...n, gitPath: ap } : n
    })

    // (4) syncToGitHub with the adopted notes → ZERO deletions; the renamed
    //     files survive. Content + path both match the remote now, so this is a
    //     clean no-op push (head unchanged).
    const headBefore = await getRefSha(HARNESS_BRANCH)
    const sync = await syncToGitHub({ token: TOKEN!, repo, notes: renNotes, folders: [] })
    expect(sync.result.deleted).toBe(0)
    const headAfter = await getRefSha(HARNESS_BRANCH)
    expect(headAfter).toBe(headBefore) // no commit at all → certainly no delete
    // Belt-and-braces: the renamed files still exist in the remote tree, and the
    // old (space-form) paths stayed gone (renamed, never duplicated).
    const treeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, headAfter)
    const tree = await getTreeMap(TOKEN!, OWNER, REPO_NAME, treeSha)
    for (const r of renames) {
      expect(tree.has(r.to)).toBe(true)    // renamed file present (content preserved)
      expect(tree.has(r.from)).toBe(false) // old name still gone
    }
    log(`[scenario 7] push after adoption: deleted=${sync.result.deleted} (head ${headBefore.slice(0, 8)} unchanged); all renamed files survive`)
  })

  // rename-not-delete GUARD 2 (push-side safety net) live proof. Even if the
  // pull classification were WRONG and a note got soft-deleted while an ACTIVE
  // note's content still maps to that remote file, syncToGitHub must NOT delete
  // it. We simulate the worst case directly: a soft-deleted note carrying the
  // old gitPath, alongside a live note whose content IS that remote blob.
  test('scenario 8: push-side safety net — soft-deleted note never deletes a file a live note still represents', async () => {
    const sStamp = Date.now()
    // Plant a note remotely and clone it so we know its exact remote path + sha.
    let live = makeNote(`safetynet ${sStamp}`, `Safety-net body ${sStamp}\n`)
    const push = await syncToGitHub({ token: TOKEN!, repo, notes: [live], folders: [] })
    live = applyPathUpdates([live], push.pathUpdates)[0]
    const livePath = live.gitPath!
    expect(livePath).toBeTruthy()

    // Construct the data-loss precondition: a SOFT-DELETED note that still
    // carries `livePath` as its gitPath (the bug's leftover), PLUS the live note
    // (same content). The safety net must refuse the delete because a live
    // note's content equals the remote blob at livePath.
    const ghost: Note = {
      ...makeNote(`safetynet ${sStamp}`, live.content),
      id: `ghost-${sStamp}`,
      isDeleted: true,
      deletedAt: Date.now(),
      gitPath: livePath,
      gitLastPushedSha: live.gitLastPushedSha,
      gitRemoteBaseSha: live.gitRemoteBaseSha,
    }

    const headBefore = await getRefSha(HARNESS_BRANCH)
    const out = await syncToGitHub({ token: TOKEN!, repo, notes: [live, ghost], folders: [] })
    expect(out.result.deleted).toBe(0)
    const headAfter = await getRefSha(HARNESS_BRANCH)
    expect(headAfter).toBe(headBefore)
    // The live note's file still exists remotely.
    const treeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, headAfter)
    const tree = await getTreeMap(TOKEN!, OWNER, REPO_NAME, treeSha)
    expect(tree.has(livePath)).toBe(true)
    log(`[scenario 8] safety net: soft-deleted ghost at ${livePath} did NOT delete the live note's file (deleted=0, head unchanged)`)
  })
})
