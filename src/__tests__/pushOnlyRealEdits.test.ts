/**
 * @jest-environment node
 *
 * pushOnlyRealEdits.test.ts
 *
 * Focused coverage for the push-only-real-edits upload-filter decision in
 * syncToGitHub. The churn bug: when the remote blob is in a NON-CANONICAL
 * shape (e.g. a freshly-imported Obsidian vault whose body has no trailing
 * newline), `remoteSha` differs from our canonical wire SHA even though the
 * user never edited the note — so the old filter (`remoteSha !== localSha`)
 * uploaded it, rewriting the whole vault into noteser's canonical form on
 * every sync.
 *
 * The fix: a note is "locally changed" iff `gitLastPushedSha == null` OR the
 * PLAINTEXT canonical SHA differs from `gitLastPushedSha`. An unchanged note
 * that already has a remote blob is SUPPRESSED — no tree entry, no upload, no
 * pathUpdate — so the base tree's original blob is preserved untouched.
 *
 * We mock the network layer (githubFetch via global.fetch) and keep the real
 * gitBlobSha so the canonical hashing runs for real. We intercept the
 * POST /git/trees body to learn exactly which paths got a tree entry.
 */

import { syncToGitHub, _resetUploadedShaCache, serializeNote } from '../utils/githubSync'
import { gitBlobSha } from '../utils/github'
import type { Note, Folder, SyncRepo } from '@/types'

jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
}))
jest.mock('../utils/lastPushedContent', () => ({
  setLastPushedContent: async () => undefined,
  getLastPushedContent: async () => null,
}))
jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ localGitignoreOverlay: '', vaultEncryptionEnabled: false }) },
}))

const REPO: SyncRepo = { owner: 'o', name: 'r', branch: 'main', isPrivate: true }

function makeNote(id: string, title: string, content: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    title,
    content,
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    gitRemoteBaseSha: null,
    ...extra,
  }
}

interface TreeEntry { path: string; sha: string | null }

// Builds a fetch mock with a configurable remote tree. Records the tree
// entries POSTed to /git/trees and whether a commit was created, so a test can
// assert exactly which paths were written (or that nothing was committed).
function makeFetchMock(remoteBlobs: Map<string, string>) {
  const record = {
    treeEntriesPosted: null as TreeEntry[] | null,
    blobsCreated: [] as string[],
    commitCreated: false,
    refUpdated: false,
  }
  const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/git/refs/heads/main') && init?.method === 'PATCH') {
      record.refUpdated = true
      return new Response(JSON.stringify({}), { status: 200 })
    }
    if (u.includes('/git/refs/heads/main')) {
      return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'parent-commit' } }), { status: 200 })
    }
    if (u.match(/\/git\/commits\/parent-commit/)) {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 })
    }
    if (u.includes('/git/trees/base-tree?recursive=1')) {
      const tree = Array.from(remoteBlobs.entries()).map(([path, sha]) => ({ path, type: 'blob', sha }))
      return new Response(JSON.stringify({ tree }), { status: 200 })
    }
    if (u.endsWith('/git/blobs') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { content: string }
      // Return a deterministic, distinct sha per created blob.
      const sha = `created-blob-${record.blobsCreated.length}`
      record.blobsCreated.push(body.content)
      return new Response(JSON.stringify({ sha }), { status: 201 })
    }
    if (u.endsWith('/git/trees') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { tree: TreeEntry[] }
      record.treeEntriesPosted = body.tree
      // Return a DIFFERENT tree sha so the empty-tree guard doesn't fire and
      // the push proceeds to commit. (When entries is empty syncToGitHub
      // returns early before reaching here.)
      return new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 })
    }
    if (u.endsWith('/git/commits') && init?.method === 'POST') {
      record.commitCreated = true
      return new Response(JSON.stringify({ sha: 'new-commit', html_url: 'https://github.com/x' }), { status: 201 })
    }
    return new Response('not mocked: ' + u, { status: 500 })
  })
  return { fetchMock, record }
}

describe('syncToGitHub — push only on a real edit (churn fix)', () => {
  beforeEach(() => { _resetUploadedShaCache() })

  test('unchanged note whose remote blob is NON-CANONICAL is SUPPRESSED (no upload, no tree entry, no commit)', async () => {
    // Remote body has NO trailing newline → non-canonical. Our canonical
    // serialization adds one, so the canonical SHA differs from the remote SHA.
    const nonCanonicalRemote = 'Hello world'
    const remoteSha = await gitBlobSha(nonCanonicalRemote)
    const canonical = serializeNote(makeNote('x', 'Note', nonCanonicalRemote))
    const canonicalSha = await gitBlobSha(canonical)
    expect(canonicalSha).not.toBe(remoteSha) // sanity: this is the churn trigger

    // Local note: body equals the remote body, baseline pinned to the canonical
    // SHA (what syncApply/backgroundFill would have stored) → NOT a real edit.
    const note = makeNote('n1', 'Note', nonCanonicalRemote, {
      gitPath: 'Note.md',
      gitLastPushedSha: canonicalSha,
      gitRemoteBaseSha: remoteSha,
    })

    const { fetchMock, record } = makeFetchMock(new Map([['Note.md', remoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({ token: 't', repo: REPO, notes: [note], folders: [] as Folder[] })

    // Nothing was pushed.
    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(record.blobsCreated).toEqual([])
    expect(record.treeEntriesPosted).toBeNull() // never reached POST /git/trees
    expect(record.commitCreated).toBe(false)
    expect(record.refUpdated).toBe(false)
    // And NO spurious pathUpdate that would rewrite the baseline.
    expect(outcome.pathUpdates).toEqual([])
  })

  test('a REAL edit to that same note still uploads (updated === 1, new tree entry at the path)', async () => {
    const nonCanonicalRemote = 'Hello world'
    const remoteSha = await gitBlobSha(nonCanonicalRemote)
    const baselineSha = await gitBlobSha(serializeNote(makeNote('x', 'Note', nonCanonicalRemote)))

    // The user edits the body → canonical SHA now differs from the baseline.
    const edited = makeNote('n1', 'Note', 'Hello world EDITED', {
      gitPath: 'Note.md',
      gitLastPushedSha: baselineSha,
      gitRemoteBaseSha: remoteSha,
    })

    const { fetchMock, record } = makeFetchMock(new Map([['Note.md', remoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({ token: 't', repo: REPO, notes: [edited], folders: [] as Folder[] })

    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.updated).toBe(1)
    expect(outcome.result.created).toBe(0)
    expect(record.blobsCreated).toHaveLength(1)
    expect(record.blobsCreated[0]).toBe(serializeNote(edited))
    expect(record.treeEntriesPosted?.map(e => e.path)).toContain('Note.md')
    expect(record.commitCreated).toBe(true)
    // The edited note gets a pathUpdate re-pinning both SHAs to the pushed blob.
    const upd = outcome.pathUpdates.find(u => u.noteId === 'n1')
    expect(upd).toBeDefined()
    expect(upd!.gitPath).toBe('Note.md')
  })

  test('a brand-new note (no remote blob, null baseline) uploads', async () => {
    const fresh = makeNote('new1', 'Fresh', 'brand new body') // gitPath null, baseline null

    const { fetchMock, record } = makeFetchMock(new Map()) // empty remote tree
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({ token: 't', repo: REPO, notes: [fresh], folders: [] as Folder[] })

    expect(outcome.result.created).toBe(1)
    expect(record.blobsCreated).toHaveLength(1)
    expect(record.treeEntriesPosted?.map(e => e.path)).toContain('Fresh.md')
    const upd = outcome.pathUpdates.find(u => u.noteId === 'new1')
    expect(upd?.gitPath).toBe('Fresh.md')
  })

  test('a MOVED note (unchanged body, new path with no remote blob) uploads at the new path and deletes the old path', async () => {
    // The note's body is unchanged since last sync (baseline == canonical SHA),
    // but it moved from "Old.md" to "New.md" (title rename). The new path has
    // NO remote blob, so it MUST still be written; the old path gets sha:null.
    const body = 'unchanged body'
    const canonicalSha = await gitBlobSha(serializeNote(makeNote('x', 'New', body)))
    const oldRemoteSha = await gitBlobSha('whatever the old path held')

    const moved = makeNote('m1', 'New', body, {
      gitPath: 'Old.md', // still points at the old remote path
      gitLastPushedSha: canonicalSha, // body never edited
      gitRemoteBaseSha: oldRemoteSha,
    })

    // Remote still has the OLD path only.
    const { fetchMock, record } = makeFetchMock(new Map([['Old.md', oldRemoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({ token: 't', repo: REPO, notes: [moved], folders: [] as Folder[] })

    // New path written (created — no remote blob there), old path deleted.
    expect(outcome.result.created).toBe(1)
    expect(outcome.result.deleted).toBe(1)
    const paths = record.treeEntriesPosted!
    const newEntry = paths.find(e => e.path === 'New.md')
    const oldEntry = paths.find(e => e.path === 'Old.md')
    expect(newEntry?.sha).toBe('created-blob-0') // a real blob, written
    expect(oldEntry?.sha).toBeNull() // deletion entry
    expect(record.commitCreated).toBe(true)
  })
})
