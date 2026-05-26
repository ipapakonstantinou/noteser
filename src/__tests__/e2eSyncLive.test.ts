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

// Attachments: we keep the REAL attachments module (NOT stubbed) so the
// realistic-vault describe block below can plant + clone + classify binary
// files end-to-end and PROVE they are not re-pushed on an unchanged clone.
// The text-only scenarios (1–8) start with an empty IDB, so the real module's
// listAttachmentPaths()/tombstones resolve to empty for them exactly as the
// old stub did — no behaviour change for those scenarios.
//
// The real module reaches FileReader / atob / btoa (blobToBase64,
// base64ToBytes) and URL.createObjectURL, none of which the Node test env
// provides. Polyfill them below before any import that might touch them.
const gPoly = globalThis as unknown as {
  atob?: (s: string) => string
  btoa?: (s: string) => string
  FileReader?: unknown
  URL: { createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void }
}
if (typeof gPoly.atob === 'undefined') {
  gPoly.atob = (s: string) => Buffer.from(s, 'base64').toString('binary')
}
if (typeof gPoly.btoa === 'undefined') {
  gPoly.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')
}
if (typeof gPoly.FileReader === 'undefined') {
  // Minimal FileReader supporting readAsDataURL — the only mode blobToBase64
  // uses. Builds `data:<mime>;base64,<payload>` from the Blob's bytes.
  class NodeFileReader {
    result: string | null = null
    error: unknown = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL(blob: { arrayBuffer: () => Promise<ArrayBuffer>; type?: string }): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(new Uint8Array(buf)).toString('base64')
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`
          this.onload?.()
        })
        .catch((err) => {
          this.error = err
          this.onerror?.()
        })
    }
  }
  gPoly.FileReader = NodeFileReader
}
if (typeof gPoly.URL.createObjectURL === 'undefined') {
  // Attachment writes invalidate a URL cache via createObjectURL/revokeObjectURL.
  // The sync path doesn't read the URL, so a stub handle is enough.
  gPoly.URL.createObjectURL = () => `blob:node/${Math.random().toString(36).slice(2)}`
  gPoly.URL.revokeObjectURL = () => undefined
}

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
  createBlobBinary,
  createTree,
  createCommit,
  updateBranchRef,
  gitBlobSha,
  gitBlobShaBytes,
  base64ToBytes,
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

// ════════════════════════════════════════════════════════════════════════════
// REALISTIC-VAULT harness (rvh). A second, separately-scoped branch
// (`claude-realistic-harness`) carrying a fixture that MIRRORS a real Obsidian
// vault written by noteser — settings.json, frontmatter notes, non-canonical
// notes (no trailing newline), a binary PNG attachment referenced two ways,
// nested folders, and filenames with spaces. The whole point: a freshly-cloned
// realistic vault with NO user edits must produce ZERO pushes on sync and ZERO
// deletes/pushes on discard.
//
// Unlike the text-only block above, these scenarios drive the REAL stores
// (note / folder / settings / github) and the REAL apply layer (applyNonConflicts
// + applyAttachmentClassifications + fillShellsInBackground), exactly as the
// production `runSync` / `runPullOnly` paths do. That is what surfaces the
// class of churn bugs the synthetic harness missed.
//
// Scenarios:
//   A. CLONE: progressive first-clone pull → apply → fill bodies. Asserts notes,
//      nested folders, spaced filenames, frontmatter notes, AND the binary
//      attachment all materialise locally.
//   B. NO-CHURN SYNC (the key one): with NOTHING edited, build the same
//      `vaultSettings` bundle production would (lastPushedHash = the seeded
//      clone hash) and call syncToGitHub. Asserts result.unchanged + branch head
//      SHA byte-identical → settings.json NOT re-pushed, attachments NOT
//      re-pushed, frontmatter / non-canonical notes NOT re-canonicalised. If
//      ANY pushes, the scenario fails LOUDLY and logs the exact churn path.
//   C. DISCARD = pull-only: resetToRemote + a PULL ONLY (mirroring
//      DiscardLocalChangesModal's runPullOnly). Asserts NO commit (head
//      unchanged) and the re-clone repopulates.
//   D. FRONTMATTER ROUND-TRIP: the frontmatter note, cloned then re-serialised
//      for push, hash-matches its baseline (suppressed) so it never re-pushes.
const RVH_BRANCH = 'claude-realistic-harness'
const rvhRepo: SyncRepo = { owner: OWNER, name: REPO_NAME, branch: RVH_BRANCH, isPrivate: false }
// Settings live under `.noteser/` (the folder noteser writes to). This makes
// settings sync ACTIVE for the realistic vault (vaultSettingsRepoPath !== null).
const RVH_SETTINGS_FOLDER = '.noteser'

const rvhMaybe = TOKEN ? describe : describe.skip

rvhMaybe('e2e GitHub sync — REALISTIC VAULT (live)', () => {
  jest.setTimeout(180_000)

  // ── Branch-ref lifecycle for the realistic branch (scoped to RVH_BRANCH). ──
  async function deleteRvhRef(): Promise<void> {
    const res = await githubFetch(
      `https://api.github.com/repos/${OWNER}/${REPO_NAME}/git/refs/heads/${RVH_BRANCH}`,
      { method: 'DELETE', headers: GH_HEADERS },
    )
    if (res.status !== 204 && res.status !== 422) {
      throw new Error(`deleteRvhRef failed (${res.status})`)
    }
  }
  async function createRvhRef(sha: string): Promise<void> {
    const res = await githubFetch(
      `https://api.github.com/repos/${OWNER}/${REPO_NAME}/git/refs`,
      {
        method: 'POST',
        headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${RVH_BRANCH}`, sha }),
      },
    )
    if (!res.ok) throw new Error(`createRvhRef failed (${res.status})`)
  }

  // A 1x1 transparent PNG (67 bytes). Realistic binary attachment content.
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
  const pngBytes = base64ToBytes(PNG_BASE64)

  // The fixture file set. Paths are repo-relative. Each entry is either text
  // (committed as a utf-8 blob via createBlob) or binary (the PNG, committed via
  // createBlobBinary). The traits each path exercises are noted inline.
  const ATTACHMENT_PATH = 'Files/Pasted image 20260101120000.png'
  // Frontmatter note (tags + aliases) under a nested folder with spaces.
  const FRONTMATTER_NOTE_PATH = 'Projects/Cloud/Amazon vs Microsoft.md'
  const FRONTMATTER_NOTE_RAW =
    '---\ntags: [cloud, comparison]\naliases: [AWS vs Azure]\n---\n' +
    'AWS and Azure compared. See ![[Pasted image 20260101120000.png]] for the chart.\n'
  // Plain note (no frontmatter), non-canonical: NO trailing newline (Obsidian).
  const PLAIN_NONCANON_PATH = 'Home Server.md'
  const PLAIN_NONCANON_RAW =
    'Notes on the home server. Embed via markdown: ![](Files/Pasted image 20260101120000.png)'
  // Plain canonical note (trailing newline) at the vault root.
  const PLAIN_CANON_PATH = 'Welcome.md'
  const PLAIN_CANON_RAW = 'Welcome to the vault. This file is already canonical.\n'

  // sanitizer-churn fixtures (THE regression the relaxed sanitizer + pushPath
  // fix). Real-vault names that contain git-LEGAL characters the OLD aggressive
  // sanitizer stripped: `&` and apostrophes. Before the fix, push re-derived the
  // path from the title, stripped the `&`/`'`, and the recomputed path no longer
  // matched the real remote path → every sync deleted the real file + created a
  // stripped-name copy (rename churn that permanently mangled the user's files).
  // The folder name itself also carries `&`, so buildFolderPath is exercised too.
  const AMP_FOLDER = 'R&D Work'
  const AMP_NOTE_PATH = `${AMP_FOLDER}/Users & groups.md`
  const AMP_NOTE_RAW = 'Access control notes for R&D. See Users & groups policy.\n'
  const APOS_NOTE_PATH = "Jake's project.md"
  const APOS_NOTE_RAW = "Jake's project kickoff notes — milestones and owners.\n"

  // settings.json content + its updatedAt. Written EXACTLY as noteser would, via
  // the app's own serializeVaultSettings over a vault slice — because Jon's real
  // settings.json WAS written by noteser. We capture the seed/clone hash so
  // scenario B can assert no re-push.
  let settingsJsonContent = ''
  let settingsJsonUpdatedAt = 0
  const SETTINGS_PATH = `${RVH_SETTINGS_FOLDER}/settings.json`

  let rvhBaseHead = ''

  // Reset the four real stores to a clean, freshly-installed state + clear IDB
  // (notes/folders/attachments). Mirrors switchVault's freshClone reset set so
  // each scenario can start from "nothing local".
  async function resetLocalState(): Promise<void> {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const { useGitHubStore } = await import('@/stores/githubStore')
    const { clearAllAttachments } = await import('../utils/attachments')

    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {}, deletedFolderPaths: [] })
    await clearAllAttachments()
    // Settings: point settingsFolderPath at `.noteser` (so settings sync is
    // active) and zero the sync bookkeeping so the cloned remote settings apply.
    useSettingsStore.setState({
      settingsFolderPath: RVH_SETTINGS_FOLDER,
      vaultSettingsUpdatedAt: 0,
      vaultSettingsLastPushedHash: '',
      vaultGitignoreDraft: null,
      vaultGitignoreRemoteSnapshot: null,
      localGitignoreOverlay: '',
      vaultEncryptionEnabled: false,
      vaultEncryptionSalt: null,
      vaultEncryptionCanary: null,
    })
    // applyAttachmentClassifications + backgroundFill read token + repo here.
    useGitHubStore.setState({ token: TOKEN!, syncRepo: rvhRepo })
  }

  // Run the production pull → apply → fill cycle against the realistic branch,
  // exactly as runSync/runPullOnly compose it. Returns the latest commit SHA.
  async function cloneAndApply(isFirstClone: boolean): Promise<string> {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const { applyNonConflicts, applyAttachmentClassifications } = await import('../utils/syncApply')
    const { fillShellsInBackground } = await import('../utils/backgroundFill')
    const { vaultSettingsRepoPath } = await import('../utils/vaultSettings')

    const settings = useSettingsStore.getState()
    const vaultSettingsPath = vaultSettingsRepoPath(settings.settingsFolderPath)
    const pull = await pullFromGitHub({
      token: TOKEN!,
      repo: rvhRepo,
      notes: useNoteStore.getState().notes,
      folders: useFolderStore.getState().folders,
      vaultSettingsPath,
      vaultSettingsLocalUpdatedAt: settings.vaultSettingsUpdatedAt,
      isFirstClone,
    })
    await applyNonConflicts(pull.classifications)
    await applyAttachmentClassifications(pull.classifications)
    // Drain shells synchronously (await the fill loop) so the post-clone state
    // is fully materialised before the assertions / the no-churn push.
    await fillShellsInBackground(() => {})
    return pull.latestCommitSha
  }

  // Build the vaultSettings bundle for a push EXACTLY as useGitHubSync.runPush
  // does (pickVaultSlice → serializeVaultSettings → hash, lastPushedHash from the
  // store's seeded value). This is the bundle the app passes to syncToGitHub.
  async function buildVaultSettingsBundle(): Promise<NonNullable<Parameters<typeof syncToGitHub>[0]['vaultSettings']>> {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const { pickVaultSlice, serializeVaultSettings, vaultSettingsHash, vaultSettingsRepoPath } =
      await import('../utils/vaultSettings')
    const settings = useSettingsStore.getState()
    const path = vaultSettingsRepoPath(settings.settingsFolderPath)!
    const slice = pickVaultSlice(settings)
    const content = serializeVaultSettings(slice, settings.vaultSettingsUpdatedAt || 0)
    const contentHash = vaultSettingsHash(content)
    return { path, content, contentHash, lastPushedHash: settings.vaultSettingsLastPushedHash }
  }

  beforeAll(async () => {
    if (!TOKEN) return
    // Seed the settings.json content from noteser's OWN serializer over a
    // realistic vault slice — i.e. exactly the bytes the app writes. We override
    // a couple of vault keys to non-default values so the file is non-trivial.
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const { pickVaultSlice, serializeVaultSettings } = await import('../utils/vaultSettings')
    // Mutate the store to a representative vault config, capture its slice, then
    // restore via resetLocalState in each scenario.
    useSettingsStore.setState({
      attachmentsFolder: 'Files',
      folderSortMode: 'modified',
      dailyNotesFolder: 'Journal',
      templatesFolder: 'Templates',
      trashMode: 'hardDelete',
    })
    settingsJsonUpdatedAt = 1735_700_000_000 // a fixed past timestamp
    settingsJsonContent = serializeVaultSettings(pickVaultSlice(useSettingsStore.getState()), settingsJsonUpdatedAt)

    // Recreate the realistic branch from main, then plant the whole fixture in a
    // single commit (text blobs + the binary PNG blob).
    const mainSha = await getRefSha(BASE_BRANCH)
    await deleteRvhRef()
    await createRvhRef(mainSha)

    const baseTreeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, mainSha)
    const pngSha = await createBlobBinary(TOKEN!, OWNER, REPO_NAME, new Blob([pngBytes.slice()], { type: 'image/png' }))
    const settingsSha = await createBlob(TOKEN!, OWNER, REPO_NAME, settingsJsonContent)
    const fmSha = await createBlob(TOKEN!, OWNER, REPO_NAME, FRONTMATTER_NOTE_RAW)
    const plainNonCanonSha = await createBlob(TOKEN!, OWNER, REPO_NAME, PLAIN_NONCANON_RAW)
    const plainCanonSha = await createBlob(TOKEN!, OWNER, REPO_NAME, PLAIN_CANON_RAW)
    const ampSha = await createBlob(TOKEN!, OWNER, REPO_NAME, AMP_NOTE_RAW)
    const aposSha = await createBlob(TOKEN!, OWNER, REPO_NAME, APOS_NOTE_RAW)

    const treeSha = await createTree(TOKEN!, OWNER, REPO_NAME, baseTreeSha, [
      { path: ATTACHMENT_PATH, mode: '100644', type: 'blob', sha: pngSha },
      { path: SETTINGS_PATH, mode: '100644', type: 'blob', sha: settingsSha },
      { path: FRONTMATTER_NOTE_PATH, mode: '100644', type: 'blob', sha: fmSha },
      { path: PLAIN_NONCANON_PATH, mode: '100644', type: 'blob', sha: plainNonCanonSha },
      { path: PLAIN_CANON_PATH, mode: '100644', type: 'blob', sha: plainCanonSha },
      { path: AMP_NOTE_PATH, mode: '100644', type: 'blob', sha: ampSha },
      { path: APOS_NOTE_PATH, mode: '100644', type: 'blob', sha: aposSha },
    ])
    const { sha: commitSha } = await createCommit(
      TOKEN!, OWNER, REPO_NAME, 'rvh: plant realistic vault fixture', treeSha, mainSha,
    )
    await updateBranchRef(TOKEN!, OWNER, REPO_NAME, RVH_BRANCH, commitSha)
    rvhBaseHead = commitSha
    log(`[rvh setup] planted realistic vault @ ${commitSha.slice(0, 8)} (settings.json updatedAt=${settingsJsonUpdatedAt})`)
  })

  afterAll(async () => {
    if (!TOKEN) return
    try {
      await deleteRvhRef()
      log(`[rvh cleanup] deleted branch ${RVH_BRANCH}`)
    } catch (err) {
      log(`[rvh cleanup] branch delete failed (ignored): ${(err as Error).message}`)
    }
  })

  test('scenario A: CLONE — progressive clone materialises notes, nested/spaced folders, frontmatter, and the binary attachment', async () => {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')
    const { listAttachmentPaths, getAttachmentBlob } = await import('../utils/attachments')

    await resetLocalState()
    const head = await cloneAndApply(true)
    expect(head).toBe(rvhBaseHead)

    const notes = useNoteStore.getState().notes
    const byPath = new Map(notes.map(n => [n.gitPath, n]))

    // Our 3 fixture notes are present (the binary + settings.json are NOT notes).
    // The realistic test repo's `main` carries other notes too; we assert our
    // fixture's traits rather than an exact count (a real vault is never empty).
    expect(byPath.has(FRONTMATTER_NOTE_PATH)).toBe(true)
    expect(byPath.has(PLAIN_NONCANON_PATH)).toBe(true)
    expect(byPath.has(PLAIN_CANON_PATH)).toBe(true)
    // Spaced filename survived as a space (no dash mangling).
    expect(FRONTMATTER_NOTE_PATH).toContain(' ')

    // Bodies filled (shells drained). Frontmatter stripped + tags inlined as #tag.
    const fmNote = byPath.get(FRONTMATTER_NOTE_PATH)!
    expect(fmNote.contentLoaded).not.toBe(false)
    expect(fmNote.content).toContain('#cloud')
    expect(fmNote.content).toContain('#comparison')
    expect(fmNote.content).not.toMatch(/^---\n/) // frontmatter delimiter gone
    expect(fmNote.content).toContain('![[Pasted image 20260101120000.png]]')

    const plainNote = byPath.get(PLAIN_NONCANON_PATH)!
    expect(plainNote.content).toContain('![](Files/Pasted image 20260101120000.png)')

    // Nested folders with spaces materialised: Projects, Projects/Cloud.
    const folderPaths = useFolderStore.getState().folders.map(f => f.name)
    expect(folderPaths).toEqual(expect.arrayContaining(['Projects', 'Cloud']))

    // Binary attachment landed in IDB at the same path.
    const attachPaths = await listAttachmentPaths()
    expect(attachPaths).toContain(ATTACHMENT_PATH)
    const blob = await getAttachmentBlob(ATTACHMENT_PATH)
    expect(blob).not.toBeNull()
    expect(blob!.size).toBe(pngBytes.length)

    log(`[scenario A] cloned realistic vault: ${notes.length} notes (3 fixture + repo base), folders [${folderPaths.join(', ')}], attachment ${ATTACHMENT_PATH} (${blob!.size}B) @ ${head.slice(0, 8)}`)
  })

  test('scenario B: NO-CHURN SYNC — unchanged clone pushes NOTHING (settings.json, attachments, frontmatter all stable)', async () => {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')

    await resetLocalState()
    await cloneAndApply(true)

    const notes = useNoteStore.getState().notes
    const folders = useFolderStore.getState().folders
    const vaultSettings = await buildVaultSettingsBundle()

    // Count network mutations so we can name the churn path if it happens.
    const realFetch = globalThis.fetch
    const mutations: Array<{ method: string; url: string }> = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') mutations.push({ method, url })
      return realFetch(input as Parameters<typeof realFetch>[0], init)
    }) as typeof fetch

    const headBefore = await getRefSha(RVH_BRANCH)
    let outcome: Awaited<ReturnType<typeof syncToGitHub>>
    try {
      outcome = await syncToGitHub({ token: TOKEN!, repo: rvhRepo, notes, folders, vaultSettings })
    } finally {
      globalThis.fetch = realFetch
    }
    const headAfter = await getRefSha(RVH_BRANCH)

    // Diagnostics FIRST so a failure prints the exact churn before the assert.
    const blobCreates = mutations.filter(m => /\/git\/blobs$/.test(m.url))
    const treeCreates = mutations.filter(m => /\/git\/trees$/.test(m.url))
    const commitCreates = mutations.filter(m => /\/git\/commits$/.test(m.url))
    const refUpdates = mutations.filter(m => /\/git\/refs\//.test(m.url))
    const churnSummary =
      `created=${outcome.result.created} updated=${outcome.result.updated} deleted=${outcome.result.deleted} ` +
      `unchanged=${outcome.result.unchanged} | blob POSTs=${blobCreates.length} tree POSTs=${treeCreates.length} ` +
      `commit POSTs=${commitCreates.length} ref PATCH/POSTs=${refUpdates.length}`
    if (
      !outcome.result.unchanged ||
      outcome.result.created + outcome.result.updated + outcome.result.deleted > 0 ||
      headAfter !== headBefore
    ) {
      console.error(
        `\n[scenario B] CHURN DETECTED on an unchanged realistic clone — a freshly-cloned vault re-pushed.\n` +
          `  ${churnSummary}\n` +
          `  head ${headBefore.slice(0, 8)} → ${headAfter.slice(0, 8)}\n` +
          `  vaultSettings.lastPushedHash=${vaultSettings.lastPushedHash} contentHash=${vaultSettings.contentHash}` +
          ` (re-push fires when these differ)\n` +
          `  blob POST count by inference — settings.json churns when the SEEDED clone hash (raw-bytes FNV) != ` +
          `the canonical re-serialisation hash; attachments churn when local gitSha != remote tree sha.\n`,
      )
    }

    // The contract: a freshly-cloned realistic vault with NO edits pushes NOTHING.
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.unchanged).toBe(true)
    expect(headAfter).toBe(headBefore)
    log(`[scenario B] no-churn sync: ${churnSummary} (head ${headBefore.slice(0, 8)} unchanged)`)
  })

  test('scenario B2: NON-CANONICAL settings.json — a clone of a settings file NOT byte-identical to the client serialisation must still not re-push', async () => {
    // The realistic worry: settings.json on the remote was written by a DIFFERENT
    // client version (or has legacy formatting / a key the current client now
    // fills with a default). Then the raw remote bytes differ from this client's
    // `serializeVaultSettings(pickVaultSlice(state), updatedAt)` — and the seeded
    // `vaultSettingsLastPushedHash` (hash of the RAW bytes, set by the pull's
    // applyRemoteVaultSettings) will NOT equal the next push's `contentHash`
    // (hash of the CANONICAL re-serialisation). If so, settings.json re-pushes on
    // an unchanged clone. We plant exactly that shape and observe.
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')
    const { parseVaultSettings, serializeVaultSettings, pickVaultSlice, vaultSettingsHash } =
      await import('../utils/vaultSettings')
    const { useSettingsStore } = await import('@/stores/settingsStore')

    // Plant a NON-CANONICAL settings.json: same logical content + updatedAt as
    // the canonical file, but re-formatted (4-space indent, no trailing newline)
    // — a file noteser's serializer would never emit verbatim. Its parse still
    // yields the same vault slice, so after clone the store holds identical
    // values; only the BYTES differ.
    const parsed = parseVaultSettings(settingsJsonContent)!
    const nonCanonicalSettings = JSON.stringify(
      { version: 1, updatedAt: parsed.updatedAt, vault: parsed.vault },
      null,
      4,
    ) // note: JSON.stringify(...,4) + NO trailing newline → differs from serializeVaultSettings (2-space + '\n')
    expect(nonCanonicalSettings).not.toBe(settingsJsonContent)

    // Re-plant settings.json on the RVH branch with the non-canonical bytes.
    const parent = await getRefSha(RVH_BRANCH)
    const baseTree = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, parent)
    const blobSha = await createBlob(TOKEN!, OWNER, REPO_NAME, nonCanonicalSettings)
    const treeSha = await createTree(TOKEN!, OWNER, REPO_NAME, baseTree, [
      { path: SETTINGS_PATH, mode: '100644', type: 'blob', sha: blobSha },
    ])
    const { sha: planted } = await createCommit(
      TOKEN!, OWNER, REPO_NAME, 'rvh: plant NON-CANONICAL settings.json', treeSha, parent,
    )
    await updateBranchRef(TOKEN!, OWNER, REPO_NAME, RVH_BRANCH, planted)

    // Clone fresh + apply (seeds vaultSettingsLastPushedHash from the RAW bytes).
    await resetLocalState()
    await cloneAndApply(true)

    // THE FIX: the SEEDED baseline is now the CANONICAL hash of the applied
    // slice (exactly what the push serializes), NOT the raw non-canonical
    // remote bytes. So an unchanged clone of a non-canonical settings.json
    // re-pushes nothing (the final contract below).
    const state = useSettingsStore.getState()
    const seeded = state.vaultSettingsLastPushedHash
    const rawHash = vaultSettingsHash(nonCanonicalSettings)
    const canonicalHash = vaultSettingsHash(
      serializeVaultSettings(pickVaultSlice(state), state.vaultSettingsUpdatedAt || 0),
    )
    expect(seeded).toBe(canonicalHash)
    expect(seeded).not.toBe(rawHash)

    // Build the bundle + push, counting blob POSTs that target settings.json by
    // diffing the remote tree's settings.json SHA before/after.
    const notes = useNoteStore.getState().notes
    const folders = useFolderStore.getState().folders
    const vaultSettings = await buildVaultSettingsBundle()
    const headBefore = await getRefSha(RVH_BRANCH)
    const outcome = await syncToGitHub({ token: TOKEN!, repo: rvhRepo, notes, folders, vaultSettings })
    const headAfter = await getRefSha(RVH_BRANCH)

    const settingsWouldRePush = seeded !== canonicalHash
    if (settingsWouldRePush || headAfter !== headBefore || !outcome.result.unchanged) {
      console.error(
        `\n[scenario B2] settings.json CHURN on a non-canonical clone — THE SUSPECTED BUG.\n` +
          `  seeded lastPushedHash (raw-bytes FNV) = ${seeded}\n` +
          `  canonical re-serialisation hash       = ${canonicalHash}\n` +
          `  push fires settings re-upload because lastPushedHash != contentHash (${vaultSettings.lastPushedHash} != ${vaultSettings.contentHash}).\n` +
          `  ROOT CAUSE: pullFromGitHub seeds vaultSettingsLastPushedHash = vaultSettingsHash(RAW remote bytes)\n` +
          `  (githubSync.ts ~L729 → settingsStore.applyRemoteVaultSettings), but syncToGitHub compares it against\n` +
          `  vaultSettingsHash(serializeVaultSettings(...)) (the client's CANONICAL bytes). When the remote file\n` +
          `  was not byte-identical to this client's serialisation, the two hashes differ → re-push on every clone.\n` +
          `  PROPOSED FIX: seed the baseline to the CANONICAL hash of the APPLIED slice, not the raw bytes —\n` +
          `  i.e. in applyRemoteVaultSettings, set vaultSettingsLastPushedHash = vaultSettingsHash(serializeVaultSettings(applied, remoteUpdatedAt)).\n` +
          `  (Mirrors the note-side fix: gitLastPushedSha is the canonical-local SHA, not the raw remote SHA.)\n` +
          `  result: created=${outcome.result.created} updated=${outcome.result.updated} unchanged=${outcome.result.unchanged}` +
          ` head ${headBefore.slice(0, 8)} → ${headAfter.slice(0, 8)}\n`,
      )
    }

    // The contract is the SAME as scenario B: an unchanged clone pushes NOTHING.
    // If this assertion FAILS, the non-canonical settings churn bug is real and
    // the diagnostic above names the exact fix.
    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created + outcome.result.updated + outcome.result.deleted).toBe(0)
    expect(headAfter).toBe(headBefore)
    log(`[scenario B2] non-canonical settings clone: seeded=${seeded} canonical=${canonicalHash} match=${seeded === canonicalHash}; push unchanged=${outcome.result.unchanged} (head ${headBefore.slice(0, 8)} unchanged)`)
  })

  test('scenario C: DISCARD = pull-only — resetToRemote + PULL makes NO commit and repopulates', async () => {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { resetToRemote } = await import('../utils/resetToRemote')

    // Start from a fully-cloned state.
    await resetLocalState()
    await cloneAndApply(true)
    const clonedCount = useNoteStore.getState().notes.length
    expect(clonedCount).toBeGreaterThanOrEqual(3) // our 3 fixture notes + repo base

    // Discard flow: resetToRemote (wipes local), then a PULL ONLY (no push) —
    // exactly DiscardLocalChangesModal.handleConfirm via runPullOnly.
    const headBefore = await getRefSha(RVH_BRANCH)
    await resetToRemote({ preserveUnpushed: true })
    expect(useNoteStore.getState().notes.length).toBe(0) // local wiped

    // runPullOnly = runPull → runApply, NO syncToGitHub. Drive that here.
    const head = await cloneAndApply(false)
    const headAfter = await getRefSha(RVH_BRANCH)

    expect(headAfter).toBe(headBefore) // pull-only made NO commit
    expect(head).toBe(headBefore)
    // Repopulated to the same set — our fixture notes are all back.
    const repaths = new Set(useNoteStore.getState().notes.map(n => n.gitPath))
    expect(repaths.has(FRONTMATTER_NOTE_PATH)).toBe(true)
    expect(repaths.has(PLAIN_NONCANON_PATH)).toBe(true)
    expect(repaths.has(PLAIN_CANON_PATH)).toBe(true)
    expect(useNoteStore.getState().notes.length).toBe(clonedCount)
    log(`[scenario C] discard = pull-only: local wiped then re-pulled ${clonedCount} notes, head ${headBefore.slice(0, 8)} unchanged (no commit)`)
  })

  test('scenario D: FRONTMATTER ROUND-TRIP — the frontmatter note re-serialises to its baseline (suppressed, never re-pushed)', async () => {
    const { useNoteStore } = await import('@/stores/noteStore')

    await resetLocalState()
    await cloneAndApply(true)

    const fmNote = useNoteStore.getState().notes.find(n => n.gitPath === FRONTMATTER_NOTE_PATH)!
    expect(fmNote).toBeDefined()
    // The push decision hinges on plainSha === gitLastPushedSha. Recompute both
    // the way syncToGitHub does and prove they match → the note is suppressed.
    const plainSha = await gitBlobSha(serializeNote(fmNote))
    expect(fmNote.gitLastPushedSha).toBe(plainSha)
    // And the raw remote bytes differ from our canonical (frontmatter stripped,
    // tags inlined) — so this is a genuine non-canonical round-trip, not a
    // trivially-identical file.
    const rawRemoteSha = await gitBlobSha(FRONTMATTER_NOTE_RAW)
    expect(rawRemoteSha).not.toBe(plainSha)
    expect(fmNote.gitRemoteBaseSha).toBe(rawRemoteSha)

    log(`[scenario D] frontmatter round-trip: canonical baseline ${plainSha.slice(0, 8)} === gitLastPushedSha (raw remote ${rawRemoteSha.slice(0, 8)} differs) → suppressed, no re-push`)
  })

  // ── sanitizer-churn: THE FIX'S DEDICATED REGRESSION ───────────────────────
  // A vault with files + folders whose names contain git-LEGAL characters the
  // OLD sanitizer stripped (`&`, apostrophes) must clone, then discard+pull,
  // then sync with ZERO pushes — no rename, no churn. On the OLD code the push
  // re-derived each path from the title, stripped the `&`/`'`, and the
  // recomputed path no longer matched the real remote path → the push deleted
  // the real file and created a stripped-name copy on EVERY sync. This scenario
  // FAILS on the old code (it would report created/deleted > 0 + a moved head)
  // and PASSES on the relaxed-sanitizer + pushPath fix.
  test('scenario E: SPECIAL-CHAR NAMES (& and apostrophe) — clone + discard/pull then sync pushes NOTHING (zero rename churn)', async () => {
    const { useNoteStore } = await import('@/stores/noteStore')
    const { useFolderStore } = await import('@/stores/folderStore')
    const { resetToRemote } = await import('../utils/resetToRemote')

    // (1) CLONE the realistic vault (which now carries "R&D Work/Users & groups.md"
    //     and "Jake's project.md").
    await resetLocalState()
    await cloneAndApply(true)

    // The special-char files materialised with their EXACT names (no `&`/`'`
    // stripping) — gitPath preserves the real remote path verbatim.
    let notes = useNoteStore.getState().notes
    const ampNote = notes.find(n => n.gitPath === AMP_NOTE_PATH)
    const aposNote = notes.find(n => n.gitPath === APOS_NOTE_PATH)
    expect(ampNote).toBeDefined()
    expect(aposNote).toBeDefined()
    // The folder with `&` in its name materialised with the character kept.
    const folderNames = useFolderStore.getState().folders.map(f => f.name)
    expect(folderNames).toEqual(expect.arrayContaining([AMP_FOLDER]))
    // And the derived push path equals the stored gitPath — the no-churn
    // invariant the fix guarantees (relaxed sanitizer makes them agree).
    const { pushPath } = await import('../utils/githubSync')
    expect(pushPath(ampNote!, useFolderStore.getState().folders)).toBe(AMP_NOTE_PATH)
    expect(pushPath(aposNote!, useFolderStore.getState().folders)).toBe(APOS_NOTE_PATH)

    // (2) DISCARD = resetToRemote + a fresh pull-only (mirrors the discard flow
    //     Jon would run on his real vault). Local is wiped then repopulated.
    await resetToRemote({ preserveUnpushed: true })
    expect(useNoteStore.getState().notes.length).toBe(0)
    await cloneAndApply(false)
    notes = useNoteStore.getState().notes
    expect(notes.find(n => n.gitPath === AMP_NOTE_PATH)).toBeDefined()
    expect(notes.find(n => n.gitPath === APOS_NOTE_PATH)).toBeDefined()

    // (3) SYNC with NOTHING edited → ZERO pushes. Count network mutations so a
    //     failure names the exact churn, and assert the branch head is byte-
    //     identical before/after (no rename commit at all).
    const folders = useFolderStore.getState().folders
    const vaultSettings = await buildVaultSettingsBundle()
    const realFetch = globalThis.fetch
    const mutations: Array<{ method: string; url: string }> = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') mutations.push({ method, url })
      return realFetch(input as Parameters<typeof realFetch>[0], init)
    }) as typeof fetch

    const headBefore = await getRefSha(RVH_BRANCH)
    let outcome: Awaited<ReturnType<typeof syncToGitHub>>
    try {
      outcome = await syncToGitHub({ token: TOKEN!, repo: rvhRepo, notes, folders, vaultSettings })
    } finally {
      globalThis.fetch = realFetch
    }
    const headAfter = await getRefSha(RVH_BRANCH)

    const treeCreates = mutations.filter(m => /\/git\/trees$/.test(m.url))
    const commitCreates = mutations.filter(m => /\/git\/commits$/.test(m.url))
    if (
      !outcome.result.unchanged ||
      outcome.result.created + outcome.result.updated + outcome.result.deleted > 0 ||
      headAfter !== headBefore
    ) {
      console.error(
        `\n[scenario E] SANITIZER CHURN DETECTED — special-char names (&/') re-pushed on an unchanged clone.\n` +
          `  created=${outcome.result.created} updated=${outcome.result.updated} deleted=${outcome.result.deleted} ` +
          `unchanged=${outcome.result.unchanged} | tree POSTs=${treeCreates.length} commit POSTs=${commitCreates.length}\n` +
          `  head ${headBefore.slice(0, 8)} → ${headAfter.slice(0, 8)}\n` +
          `  ROOT CAUSE on the old code: notePath() re-derived the path from the title via the aggressive\n` +
          `  sanitizer, stripping &/' so "${AMP_NOTE_PATH}" became a stripped-name path that no longer matched\n` +
          `  the real remote file → push deleted the real file + created the stripped copy (rename churn).\n`,
      )
    }

    // THE CONTRACT: a freshly-cloned vault with &/' names, discarded + re-pulled,
    // pushes NOTHING. (No rename, no delete, no create, no commit.)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.unchanged).toBe(true)
    expect(headAfter).toBe(headBefore)

    // Belt-and-braces: the special-char files still exist remotely under their
    // EXACT names (never renamed to a stripped form).
    const treeSha = await getCommitTreeSha(TOKEN!, OWNER, REPO_NAME, headAfter)
    const tree = await getTreeMap(TOKEN!, OWNER, REPO_NAME, treeSha)
    expect(tree.has(AMP_NOTE_PATH)).toBe(true)
    expect(tree.has(APOS_NOTE_PATH)).toBe(true)
    // The stripped-name forms the OLD bug would have created must NOT exist.
    expect(tree.has('RD Work/Users  groups.md')).toBe(false)
    expect(tree.has('Jakes project.md')).toBe(false)

    log(`[scenario E] special-char (&/') no-churn: clone + discard/pull then sync deleted=0 created=0 updated=0 (head ${headBefore.slice(0, 8)} unchanged); "${AMP_NOTE_PATH}" + "${APOS_NOTE_PATH}" survive verbatim`)
  })
})
