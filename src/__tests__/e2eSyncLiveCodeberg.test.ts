/**
 * @jest-environment node
 *
 * e2eSyncLiveCodeberg.test.ts
 *
 * END-TO-END harness that drives noteser's REAL sync pipeline
 * (`pullFromGitHub` / `syncToGitHub`) against a LIVE Codeberg (Forgejo) repo
 * through the ForgejoProvider. Where e2eSyncLive.test.ts proves the GitHub
 * path, this proves the WHOLE flow on Forgejo — not just the provider in
 * isolation — and answers the open optimistic-concurrency question for the
 * ChangeFiles write path (#17 / #24).
 *
 * It only runs when `CODEBERG_TEST_TOKEN` is present — otherwise every test
 * self-skips, so the normal `npm test` suite stays green. Run it with the
 * token loaded:
 *   npm run e2e:sync:codeberg
 * which sources ~/.config/noteser/codeberg-test-token.env and runs only this
 * file.
 *
 * Target: rotecodefraktion/noteser-codeberg-test (override via
 * CODEBERG_TEST_OWNER / CODEBERG_TEST_REPO). Base URL defaults to
 * https://codeberg.org (ForgejoProvider's default).
 *
 * SAFETY: the harness NEVER touches `main`. It operates on a per-run harness
 * branch (timestamped name) created from main via the Gitea branch API and
 * deleted in afterAll (best-effort). The token value is read at runtime and
 * never logged.
 *
 * What it asserts (each scenario logged with a [scenario] tag):
 *   1. Baseline pull on the empty harness branch → no conflict / remoteDeleted.
 *   2. Push 3 new notes (spaced titles) → created === 3, commitSha, head moved.
 *   3. Re-pull with those 3 as local state → all unchanged, paths preserved.
 *   4. Update one note → updated === 1, new commit.
 *   5. No-churn: re-push unchanged → unchanged === true, head unchanged.
 *   6. Delete one note (soft-delete) → removed remotely.
 *   7. CONCURRENCY PROBE: capture head, make an out-of-band remote change via
 *      ChangeFiles directly on the harness branch, then syncToGitHub with a
 *      STALE parentSha baseline → DOCUMENT what ChangeFiles does (reject /
 *      merge / overwrite). This answers the open optimistic-concurrency item.
 */

// idb-keyval backed by an in-memory Map (the Zustand persist layer +
// attachments.ts need somewhere to write under Node). The providers /
// github.ts stay REAL — the whole point is the network calls go to Codeberg.
jest.mock('idb-keyval', () => {
  const store = new Map<IDBValidKey, unknown>()
  return {
    get: jest.fn(async (key: IDBValidKey) => store.get(key)),
    set: jest.fn(async (key: IDBValidKey, val: unknown) => {
      store.set(key, val)
    }),
    del: jest.fn(async (key: IDBValidKey) => {
      store.delete(key)
    }),
    keys: jest.fn(async () => Array.from(store.keys())),
    clear: jest.fn(async () => {
      store.clear()
    })
  }
})

// Polyfills for the Node test env. fetch is provided natively on Node 22, so we
// only fill the WebCrypto / text codec / base64 surface the sync stack touches.
// (attachments.ts is not exercised here — text-only scenarios — but we polyfill
// atob/btoa/FileReader/URL defensively to match the GitHub harness's setup.)
import { webcrypto } from 'node:crypto'
import { TextEncoder, TextDecoder } from 'node:util'

const g = globalThis as unknown as {
  crypto?: Crypto
  TextEncoder?: typeof TextEncoder
  TextDecoder?: typeof TextDecoder
  atob?: (s: string) => string
  btoa?: (s: string) => string
  FileReader?: unknown
  URL: {
    createObjectURL?: (b: unknown) => string
    revokeObjectURL?: (u: string) => void
  }
}
if (typeof g.crypto === 'undefined' || !g.crypto.subtle) {
  g.crypto = webcrypto as unknown as Crypto
}
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder
if (typeof g.atob === 'undefined') {
  g.atob = (s: string) => Buffer.from(s, 'base64').toString('binary')
}
if (typeof g.btoa === 'undefined') {
  g.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')
}
if (typeof g.URL.createObjectURL === 'undefined') {
  g.URL.createObjectURL = () =>
    `blob:node/${Math.random().toString(36).slice(2)}`
  g.URL.revokeObjectURL = () => undefined
}

import { pullFromGitHub, syncToGitHub } from '../utils/githubSync'
import { ForgejoProvider } from '../utils/gitHost/forgejoProvider'
import type { Note, SyncRepo } from '@/types'

const TOKEN = process.env.CODEBERG_TEST_TOKEN
const OWNER = process.env.CODEBERG_TEST_OWNER || 'rotecodefraktion'
const REPO_NAME = process.env.CODEBERG_TEST_REPO || 'noteser-codeberg-test'
const BASE_URL = 'https://codeberg.org'
const BASE_BRANCH = 'main'
// Unique per run so concurrent / repeated runs never collide.
const HARNESS_BRANCH = `claude-harness-${Date.now()}`

const repo: SyncRepo = {
  owner: OWNER,
  name: REPO_NAME,
  branch: HARNESS_BRANCH,
  isPrivate: true
}

// ── Gitea branch + ChangeFiles helpers (the Forgejo equivalents of the
// GitHub harness's git/refs lifecycle). All use `Authorization: token <PAT>`.
const API = `${BASE_URL}/api/v1`
const giteaHeaders = (extra: Record<string, string> = {}) => ({
  Authorization: `token ${TOKEN}`,
  Accept: 'application/json',
  ...extra
})

/** Create the harness branch from main via POST /branches. */
async function createHarnessBranch(): Promise<void> {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO_NAME}/branches`, {
    method: 'POST',
    headers: giteaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      new_branch_name: HARNESS_BRANCH,
      old_branch_name: BASE_BRANCH
    })
  })
  if (!res.ok) throw new Error(`createHarnessBranch failed (${res.status})`)
}

/** Delete the harness branch via DELETE /branches/{name}. Best-effort. */
async function deleteHarnessBranch(): Promise<void> {
  const res = await fetch(
    `${API}/repos/${OWNER}/${REPO_NAME}/branches/${HARNESS_BRANCH}`,
    {
      method: 'DELETE',
      headers: giteaHeaders()
    }
  )
  // 204 = deleted, 404 = already gone. Anything else is a real failure.
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`deleteHarnessBranch failed (${res.status})`)
  }
}

/** Head sha of the harness branch via GET /branches/{name} → .commit.id. */
async function getHarnessHeadSha(): Promise<string> {
  const res = await fetch(
    `${API}/repos/${OWNER}/${REPO_NAME}/branches/${HARNESS_BRANCH}`,
    {
      headers: giteaHeaders()
    }
  )
  if (!res.ok) throw new Error(`getHarnessHeadSha failed (${res.status})`)
  const data = (await res.json()) as { commit: { id: string } }
  return data.commit.id
}

/** Blob sha of `path` on the harness branch, or null when absent. */
async function getRemoteBlobSha(path: string): Promise<string | null> {
  const res = await fetch(
    `${API}/repos/${OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=${HARNESS_BRANCH}`,
    { headers: giteaHeaders() }
  )
  if (res.status === 404) return null
  if (!res.ok)
    throw new Error(`getRemoteBlobSha(${path}) failed (${res.status})`)
  const data = (await res.json()) as { sha: string }
  return data.sha
}

/**
 * Write `content` to `path` on the harness branch out-of-band via the SAME
 * ChangeFiles batch API the provider uses (POST /contents). This advances the
 * branch head independently of any pending syncToGitHub baseline — the setup
 * for the concurrency probe. Returns the new head sha.
 */
async function writeRemoteFileOutOfBand(
  path: string,
  content: string
): Promise<string> {
  const existing = await getRemoteBlobSha(path)
  const op = existing ? 'update' : 'create'
  const file: Record<string, unknown> = {
    operation: op,
    path,
    content: Buffer.from(content, 'utf8').toString('base64')
  }
  if (existing) file.sha = existing
  const res = await fetch(`${API}/repos/${OWNER}/${REPO_NAME}/contents`, {
    method: 'POST',
    headers: giteaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      branch: HARNESS_BRANCH,
      message: `harness: out-of-band ${op} ${path}`,
      files: [file]
    })
  })
  if (!res.ok)
    throw new Error(`writeRemoteFileOutOfBand(${path}) failed (${res.status})`)
  const data = (await res.json()) as { commit: { sha: string } }
  return data.commit.sha
}

// ── Local note factory + path-update applier (mirrors the GitHub harness). ──
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
    gitRemoteBaseSha: null
  }
}

function applyPathUpdates(
  notes: Note[],
  updates: {
    noteId: string
    gitPath: string | null
    gitLastPushedSha: string | null
    gitRemoteBaseSha: string | null
  }[]
): Note[] {
  const byId = new Map(updates.map(u => [u.noteId, u]))
  return notes.map(n => {
    const u = byId.get(n.id)
    if (!u) return n
    return {
      ...n,
      gitPath: u.gitPath,
      gitLastPushedSha: u.gitLastPushedSha,
      gitRemoteBaseSha: u.gitRemoteBaseSha
    }
  })
}

const log = (msg: string) => console.log(`  ${msg}`)
const newProvider = () => new ForgejoProvider(TOKEN!, BASE_URL)

const maybe = TOKEN ? describe : describe.skip

maybe('e2e Codeberg/Forgejo sync (live)', () => {
  // Live API calls — give the suite a generous bound. runInBand + no loops to
  // respect Codeberg's burst rate-limit.
  jest.setTimeout(120_000)

  const stamp = Date.now()
  // Spaced titles prove sanitizeFilename keeps spaces through the round-trip
  // and a spaced path still classifies `unchanged` (no re-upload churn).
  const titles = [1, 2, 3].map(i => `cb harness ${stamp} note ${i}`)
  let notes: Note[] = titles.map((t, i) =>
    makeNote(t, `Note ${i + 1} body for ${t}\n`)
  )
  let baselineHeadSha = ''

  beforeAll(async () => {
    if (!TOKEN) return
    await createHarnessBranch()
    baselineHeadSha = await getHarnessHeadSha()
    log(
      `[setup] created ${HARNESS_BRANCH} from ${BASE_BRANCH} @ ${baselineHeadSha.slice(0, 8)}`
    )
  })

  afterAll(async () => {
    if (!TOKEN) return
    try {
      await deleteHarnessBranch()
      log(`[cleanup] deleted branch ${HARNESS_BRANCH}`)
    } catch (err) {
      log(`[cleanup] branch delete failed (ignored): ${(err as Error).message}`)
    }
  })

  test('scenario 1: baseline pull on the empty harness branch → no conflict / remoteDeleted', async () => {
    const pull = await pullFromGitHub({
      provider: newProvider(),
      repo,
      notes: [],
      folders: []
    })
    const kinds = pull.classifications.reduce<Record<string, number>>(
      (acc, c) => {
        acc[c.kind] = (acc[c.kind] ?? 0) + 1
        return acc
      },
      {}
    )
    expect(pull.latestCommitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(kinds['remoteDeleted'] ?? 0).toBe(0)
    expect(kinds['conflict'] ?? 0).toBe(0)
    log(
      `[scenario 1] baseline pull classifications: ${JSON.stringify(kinds)} (latestCommitSha ${pull.latestCommitSha.slice(0, 8)})`
    )
  })

  test('scenario 2: push 3 new notes → created === 3 + commitSha + head advanced', async () => {
    const before = await getHarnessHeadSha()
    const outcome = await syncToGitHub({
      provider: newProvider(),
      repo,
      notes,
      folders: []
    })

    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.created).toBe(3)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(outcome.result.commitSha).not.toBe(before)
    const after = await getHarnessHeadSha()
    expect(after).toBe(outcome.result.commitSha)

    notes = applyPathUpdates(notes, outcome.pathUpdates)
    expect(notes.every(n => n.gitPath && n.gitLastPushedSha)).toBe(true)
    log(
      `[scenario 2] pushed 3 notes: created=${outcome.result.created} commit=${outcome.result.commitSha.slice(0, 8)} (head ${before.slice(0, 8)} → ${after.slice(0, 8)})`
    )
  })

  test('scenario 3: re-pull with the 3 notes as local state → all unchanged, paths preserved', async () => {
    const pull = await pullFromGitHub({
      provider: newProvider(),
      repo,
      notes,
      folders: []
    })

    const ourIds = new Set(notes.map(n => n.id))
    const ours = pull.classifications.filter(
      c => 'noteId' in c && ourIds.has((c as { noteId: string }).noteId)
    )
    expect(ours).toHaveLength(3)
    for (const c of ours) expect(c.kind).toBe('unchanged')

    // No remoteCreated entry should match one of our note paths (the twin bug).
    const ourPaths = new Set(notes.map(n => n.gitPath))
    const stray = pull.classifications.find(
      c =>
        c.kind === 'remoteCreated' && ourPaths.has((c as { path: string }).path)
    )
    expect(stray).toBeUndefined()
    // Spaces in the title survived as spaces in the git path.
    expect(notes.every(n => n.gitPath?.includes(' '))).toBe(true)
    log(
      `[scenario 3] re-pull: all 3 notes (spaced titles) classified unchanged, paths kept spaces, no duplicate remoteCreated`
    )
  })

  test('scenario 4: update one note → updated === 1 + a new commit exists', async () => {
    const before = await getHarnessHeadSha()
    notes = notes.map((n, i) =>
      i === 0
        ? {
            ...n,
            content: `${n.content}edited at ${Date.now()}\n`,
            updatedAt: Date.now()
          }
        : n
    )

    const outcome = await syncToGitHub({
      provider: newProvider(),
      repo,
      notes,
      folders: []
    })
    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.updated).toBe(1)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(outcome.result.commitSha).not.toBe(before)
    const after = await getHarnessHeadSha()
    expect(after).toBe(outcome.result.commitSha)

    notes = applyPathUpdates(notes, outcome.pathUpdates)
    log(
      `[scenario 4] updated 1 note: updated=${outcome.result.updated} new commit=${outcome.result.commitSha.slice(0, 8)} (head ${before.slice(0, 8)} → ${after.slice(0, 8)})`
    )
  })

  test('scenario 5: no-churn — re-push unchanged notes makes no new commit', async () => {
    const before = await getHarnessHeadSha()
    const outcome = await syncToGitHub({
      provider: newProvider(),
      repo,
      notes,
      folders: []
    })

    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    const after = await getHarnessHeadSha()
    expect(after).toBe(before)
    log(
      `[scenario 5] re-push unchanged: unchanged=${outcome.result.unchanged}, head unchanged @ ${after.slice(0, 8)} (no commit)`
    )
  })

  test('scenario 6: delete one note (soft-delete) → removed remotely', async () => {
    const target = notes[2]
    const targetPath = target.gitPath!
    expect(await getRemoteBlobSha(targetPath)).not.toBeNull() // present before delete

    notes = notes.map(n =>
      n.id === target.id ? { ...n, isDeleted: true, deletedAt: Date.now() } : n
    )
    const outcome = await syncToGitHub({
      provider: newProvider(),
      repo,
      notes,
      folders: []
    })
    expect(outcome.result.deleted).toBe(1)
    expect(outcome.result.commitSha).toMatch(/^[0-9a-f]{40}$/)

    expect(await getRemoteBlobSha(targetPath)).toBeNull() // gone after delete
    // Drop it locally so later scenarios don't re-reference it.
    notes = notes.filter(n => n.id !== target.id)
    log(
      `[scenario 6] soft-delete: deleted=${outcome.result.deleted}, remote file ${targetPath} removed`
    )
  })

  // ── CONCURRENCY PROBE — the key open question (#17 / #24). ──
  // Forgejo's ChangeFiles (POST /contents) takes a `branch` but NO expected
  // parent/head sha — CommitRequest.parentSha is computed by the caller and
  // (in the GitHub provider) used as the commit parent, but the Forgejo
  // provider never sends it. So the question is: when a SECOND writer advances
  // the branch out-of-band AFTER we captured our baseline, does ChangeFiles
  // reject the now-stale write, silently merge it, or clobber the concurrent
  // change?
  //
  // We drive `provider.commitChanges` DIRECTLY here (not syncToGitHub) for two
  // reasons: (1) it is the exact ChangeFiles write path the seam exposes, and
  // (2) syncToGitHub's read phase is GitHub-hardcoded (see syncPush.ts:155 →
  // getBranchRefSha against api.github.com), so it never reaches the Forgejo
  // write on Codeberg — see the report. Driving commitChanges directly gives a
  // CLEAN answer to the concurrency question.
  //
  // Outcomes:
  //   - reject (4xx)       → ChangeFiles enforces optimistic concurrency. SAFE.
  //   - silently merge      → our edit AND the out-of-band file both survive
  //                           (ChangeFiles edits only the named paths and
  //                           carries the rest of the tree forward). SAFE.
  //   - overwrite/clobber   → the out-of-band file is LOST. UNSAFE lost-update.
  test('concurrency probe: stale-baseline ChangeFiles vs out-of-band edit', async () => {
    const provider = newProvider()

    // (0) Seed a file we will edit, so the stale write is an UPDATE (the case
    //     that needs the current blob sha) and capture the head as our baseline.
    const targetPath = `cb harness ${stamp} probe-target.md`
    await writeRemoteFileOutOfBand(
      targetPath,
      `Initial probe-target body at ${Date.now()}\n`
    )
    const baselineHead = await getHarnessHeadSha()
    const targetSha = await getRemoteBlobSha(targetPath)
    expect(targetSha).not.toBeNull()

    // (1) Out-of-band remote change: a SEPARATE new file via ChangeFiles,
    //     advancing the branch head PAST our captured baseline.
    const oobPath = `cb harness ${stamp} out-of-band.md`
    const oobBody = `Out-of-band content written directly via ChangeFiles at ${Date.now()}\n`
    const oobHead = await writeRemoteFileOutOfBand(oobPath, oobBody)
    expect(oobHead).not.toBe(baselineHead)
    expect(await getRemoteBlobSha(oobPath)).not.toBeNull()
    log(
      `[probe] out-of-band write advanced head ${baselineHead.slice(0, 8)} → ${oobHead.slice(0, 8)} (${oobPath})`
    )

    // (2) Now WE commit an update to targetPath with the STALE baselineHead as
    //     parentSha — the classic concurrent-writer race. We hold targetSha
    //     (still valid: the OOB write touched a different path), so the only
    //     stale input is parentSha.
    let pushError: Error | null = null
    let result: Awaited<ReturnType<typeof provider.commitChanges>> | null = null
    try {
      result = await provider.commitChanges(repo, {
        branch: HARNESS_BRANCH,
        parentSha: baselineHead, // STALE: head already moved to oobHead
        message: `harness: stale-baseline update ${targetPath}`,
        changes: [
          {
            op: 'update',
            path: targetPath,
            content: `Edited under stale baseline at ${Date.now()}\n`,
            sha: targetSha!
          }
        ]
      })
    } catch (err) {
      pushError = err as Error
    }

    const oobSurvives = (await getRemoteBlobSha(oobPath)) !== null
    const headAfter = await getHarnessHeadSha()

    if (pushError) {
      log(
        `[probe] RESULT = REJECT: ChangeFiles refused the stale-baseline write (${pushError.message}). Out-of-band file survives: ${oobSurvives}. Optimistic concurrency is ENFORCED — SAFE.`
      )
      expect(oobSurvives).toBe(true)
    } else if (oobSurvives) {
      log(
        `[probe] RESULT = MERGE/SAFE: ChangeFiles committed our update (head ${baselineHead.slice(0, 8)} → ${headAfter.slice(0, 8)}) despite the stale parentSha, AND the out-of-band file survives. ChangeFiles IGNORES parentSha and edits ONLY the named paths, carrying the rest of the tree forward — no optimistic-concurrency rejection, but ALSO no lost-update for the untouched OOB file.`
      )
      expect(result).not.toBeNull()
      expect(result!.committed).toBe(true)
      expect(oobSurvives).toBe(true)
    } else {
      log(
        `[probe] RESULT = CLOBBER/UNSAFE: ChangeFiles committed under the stale baseline but the out-of-band file was LOST (head ${baselineHead.slice(0, 8)} → ${headAfter.slice(0, 8)}). NO optimistic-concurrency guard AND it overwrote a concurrent remote change — DATA LOSS GAP (#17/#24).`
      )
      expect(oobSurvives).toBe(true) // intentional fail to surface the gap
    }
  })
})
