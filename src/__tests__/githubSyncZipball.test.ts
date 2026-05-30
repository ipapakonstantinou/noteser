/**
 * githubSyncZipball.test.ts
 *
 * Exercises the first-clone fast path `pullFromZipball` end to end, with the
 * real `jszip` runtime loaded via its dynamic `await import('jszip')` call.
 *
 * Triage context: commit 8262831 ("Perf: lazy-load jszip + file-saver")
 * switched `pullFromZipball` from a top-level `import JSZip from 'jszip'` to
 * `const { default: JSZip } = await import('jszip')`. The export lazy path
 * has an e2e spec, but the zipball PULL path had no coverage. If the dynamic
 * import resolved to the wrong interop shape (e.g. `default` undefined), the
 * first clone would throw and the user would see an empty vault.
 *
 * Strategy: mock ONLY the network seam (`./githubFetch`) so `getBranchRefSha`
 * and `fetchZipball` resolve against an in-memory zip we build with the real
 * jszip. Everything else in `githubSync.ts` / `github.ts` (the dynamic
 * import, `JSZip.loadAsync`, `gitBlobSha`, classification) runs for real.
 */

// ── Web-API polyfills ───────────────────────────────────────────────────────
// jsdom ships neither TextEncoder/Decoder nor crypto.subtle; gitBlobSha needs
// both. Polyfill from Node before any module-under-test imports.
import { TextEncoder, TextDecoder } from 'util'
import { webcrypto } from 'crypto'
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder
}
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true })
}

// ── idb-keyval mock (attachments + zustand persist touch it) ────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── network seam mock ────────────────────────────────────────────────────────
// githubFetch is the single transport both getBranchRefSha and fetchZipball
// route through. We dispatch on the URL/path so the ref read returns JSON and
// the zipball read returns the raw archive bytes.
const mockGithubFetch = jest.fn()
jest.mock('../utils/githubFetch', () => ({
  githubFetch: (...a: unknown[]) => mockGithubFetch(...a),
}))

import JSZip from 'jszip'
import { pullFromZipball, takeZipballAttachmentBytes } from '../utils/githubSync'
import type { SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }
const HEAD_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

// Build a minimal but valid repo zipball. GitHub wraps everything under a
// single top-level dir `<owner>-<repo>-<short-sha>/`, so we mirror that.
const ZIP_ROOT = 'me-vault-deadbee'

async function buildZipBuffer(
  files: Record<string, string | Uint8Array>,
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [rel, content] of Object.entries(files)) {
    zip.file(`${ZIP_ROOT}/${rel}`, content)
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

// jsdom under this suite doesn't expose the Fetch `Response` constructor, so we
// hand back a minimal duck-typed stand-in carrying only what the callees touch:
// `ok` (ensureOk), `json()` (getBranchRefSha), `arrayBuffer()` (fetchZipball),
// and `headers.get('content-length')` (size-mismatch guard added 2026-05-24).
type FakeResponse = Pick<Response, 'ok'> & {
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
  headers: { get(name: string): string | null }
}

// Returning null for content-length tells the size-mismatch guard to fall
// through to JSZip (proxy stripped the header / chunked transfer path),
// which is the right behaviour for these mocked responses.
const noHeaders = { get: (_name: string) => null }

function refResponse(): FakeResponse {
  const body = { ref: `refs/heads/${REPO.branch}`, object: { sha: HEAD_SHA } }
  return {
    ok: true,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: noHeaders,
  }
}

function zipResponse(buf: ArrayBuffer): FakeResponse {
  return {
    ok: true,
    json: async () => ({}),
    arrayBuffer: async () => buf,
    headers: noHeaders,
  }
}

function wireFetch(zipBuffer: ArrayBuffer): void {
  mockGithubFetch.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/github/zipball')) {
      return zipResponse(zipBuffer)
    }
    // Everything else in this suite is the ref read.
    return refResponse()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('pullFromZipball loads jszip via dynamic import and classifies .md files as remoteCreated', async () => {
  const zipBuffer = await buildZipBuffer({
    'note1.md': '# Note One\n\nhello world',
    // Frontmatter tags are the wire format parseNote reads (inline #tags are
    // a UI-only convenience derived later, not stored in frontmatter).
    'sub/note2.md': '---\ntags: [tagged, work]\n---\n# Note Two\n\nbody',
    // Root README rides along (pullFromZipball pulls ALL .md).
    'README.md': '# repo readme',
  })
  wireFetch(zipBuffer)

  const { classifications, latestCommitSha } = await pullFromZipball({ token: 't', repo: REPO })

  expect(latestCommitSha).toBe(HEAD_SHA)

  // The dynamic import resolved + loadAsync ran: we got classifications back.
  const created = classifications.filter(c => c.kind === 'remoteCreated')
  const paths = created.map(c => (c as { path: string }).path).sort()
  // README.md is a .md too — pullFromZipball pulls ALL .md (it does not
  // special-case the repo root README), so it rides along. The two notes
  // under the vault are the load-bearing assertion.
  expect(paths).toEqual(['README.md', 'note1.md', 'sub/note2.md'])

  const note2 = created.find(c => (c as { path: string }).path === 'sub/note2.md') as {
    path: string; remoteContent: string; remoteSha: string; tags: string[]
  }
  expect(note2.remoteContent).toContain('Note Two')
  expect(note2.tags).toContain('tagged')
  // remoteSha is a real git blob SHA-1 (40 hex chars) computed via crypto.subtle.
  expect(note2.remoteSha).toMatch(/^[0-9a-f]{40}$/)
})

test('pullFromZipball classifies files under the attachments folder as attachmentCreated and stashes bytes', async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const zipBuffer = await buildZipBuffer({
    'note1.md': '# Note',
    'attachments/diagram.png': pngBytes,
  })
  wireFetch(zipBuffer)

  const { classifications } = await pullFromZipball({ token: 't', repo: REPO })

  const attach = classifications.find(c => c.kind === 'attachmentCreated') as {
    path: string; mime: string; remoteSha: string
  }
  expect(attach).toBeDefined()
  expect(attach.path).toBe('attachments/diagram.png')
  expect(attach.mime).toBe('image/png')
  expect(attach.remoteSha).toMatch(/^[0-9a-f]{40}$/)

  // pullFromZipball stashed the bytes so apply doesn't re-fetch them.
  const stashed = takeZipballAttachmentBytes('attachments/diagram.png')
  expect(stashed).not.toBeNull()
  expect(Array.from(stashed!.bytes)).toEqual(Array.from(pngBytes))
})

test('pullFromZipball does not throw on an empty repo (only ignored root files)', async () => {
  const zipBuffer = await buildZipBuffer({
    'README.md': '# only a readme',
    '.github/workflows/ci.yml': 'name: ci',
  })
  wireFetch(zipBuffer)

  await expect(pullFromZipball({ token: 't', repo: REPO })).resolves.toBeDefined()
})
