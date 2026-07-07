/**
 * @jest-environment node
 *
 * zipballRetry.test.ts
 *
 * The first-clone fast path downloads the whole vault as one zip (the
 * zipball). On a large vault over a flaky mobile connection that single big
 * download sometimes arrives truncated, so JSZip throws "Corrupted zip: can't
 * find end of central directory" and the user had to tap Retry by hand (~3
 * times to succeed on a 692-note / 173-image vault).
 *
 * pullFromZipball now wraps the download + parse in a short retry loop. These
 * tests pin that behaviour:
 *   - a corrupted first attempt is retried and the pull SUCCEEDS (no error
 *     surfaced), with fetchZipball + JSZip.loadAsync called more than once.
 *   - a persistently corrupted archive surfaces the error after the max
 *     attempts (the existing "→ toast with Retry" behaviour is preserved).
 *
 * Strategy: mock the github.ts network surface (getBranchRefSha + fetchZipball)
 * and mock jszip's loadAsync so we can script per-attempt failure/success.
 * gitBlobSha stays mocked too — we only care about the retry control flow, not
 * real hashing here.
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// No binary attachments in these tests — keep the entry walk to .md only.
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  listAttachmentPathsTracked: async () => ({ value: [], timedOut: false }),
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
}))

// ── github.ts mock — ref + zipball download controllable ────────────────────
const mockGetBranchRefSha = jest.fn()
const mockFetchZipball = jest.fn()

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    getBranchRefSha: (...a: unknown[]) => mockGetBranchRefSha(...a),
    fetchZipball: (...a: unknown[]) => mockFetchZipball(...a),
    // gitBlobSha is stubbed — we don't assert on the computed SHA here.
    gitBlobSha: jest.fn().mockResolvedValue('blobsha'),
    gitBlobShaBytes: jest.fn().mockResolvedValue('bytessha'),
  }
})

// ── jszip mock — loadAsync scripted per attempt ─────────────────────────────
const mockLoadAsync = jest.fn()
jest.mock('jszip', () => ({
  __esModule: true,
  default: { loadAsync: (...a: unknown[]) => mockLoadAsync(...a) },
}))

import { pullFromZipball } from '../utils/githubSync'
import { GitHubProvider } from '../utils/gitHost/githubProvider'
import type { SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

// A fake JSZip object exposing the `forEach` the parser walks. We feed it a
// single .md entry so the pull yields one `remoteCreated` classification.
function fakeZipWithOneNote() {
  return {
    forEach: (cb: (rel: string, file: { dir: boolean; async: (t: string) => Promise<string> }) => void) => {
      cb('me-vault-abc123/Hello.md', {
        dir: false,
        async: async () => 'Hello world\n',
      })
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  // The buffer bytes are irrelevant — loadAsync is mocked, so it never parses.
  mockFetchZipball.mockResolvedValue(new ArrayBuffer(8))
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

// Helper: advance the fake backoff timers as the retry loop schedules them.
// The loop awaits a setTimeout between attempts; flushing microtasks +
// running pending timers lets the next attempt fire under fake timers.
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  // Drain backoff sleeps until the promise settles. Each loop tick lets any
  // pending microtask resolve, then fast-forwards the scheduled setTimeout.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
    jest.runOnlyPendingTimers()
  }
  return p
}

test('retries a corrupted first attempt and SUCCEEDS without surfacing the error', async () => {
  mockLoadAsync
    .mockRejectedValueOnce(new Error("Corrupted zip: can't find end of central directory"))
    .mockResolvedValueOnce(fakeZipWithOneNote())

  const onPhase = jest.fn()
  const outcome = await runWithTimers(pullFromZipball({ provider: new GitHubProvider('t'), repo: REPO, onPhase }))

  // It retried: download + parse each ran twice.
  expect(mockFetchZipball).toHaveBeenCalledTimes(2)
  expect(mockLoadAsync).toHaveBeenCalledTimes(2)
  // The pull succeeded and yielded the note.
  expect(outcome.latestCommitSha).toBe('headsha')
  expect(outcome.classifications).toHaveLength(1)
  expect(outcome.classifications[0]).toMatchObject({ kind: 'remoteCreated', path: 'Hello.md' })
  // The retry surfaced a phase hint with the attempt number.
  expect(onPhase).toHaveBeenCalledWith('Vault download incomplete, retrying (2 of 3)…')
})

test('also retries when fetchZipball itself throws (e.g. truncated-length guard)', async () => {
  mockFetchZipball
    .mockRejectedValueOnce(new Error('Truncated zipball download: received 10 bytes, expected 999'))
    .mockResolvedValueOnce(new ArrayBuffer(8))
  mockLoadAsync.mockResolvedValueOnce(fakeZipWithOneNote())

  const outcome = await runWithTimers(pullFromZipball({ provider: new GitHubProvider('t'), repo: REPO }))

  expect(mockFetchZipball).toHaveBeenCalledTimes(2)
  expect(outcome.classifications).toHaveLength(1)
})

test('gives up and surfaces the error after the max attempts', async () => {
  const err = new Error("Corrupted zip: can't find end of central directory")
  mockLoadAsync.mockRejectedValue(err)

  await expect(
    runWithTimers(pullFromZipball({ provider: new GitHubProvider('t'), repo: REPO })),
  ).rejects.toThrow("can't find end of central directory")

  // Three attempts total (MAX_ATTEMPTS), then the error is re-thrown.
  expect(mockFetchZipball).toHaveBeenCalledTimes(3)
  expect(mockLoadAsync).toHaveBeenCalledTimes(3)
})
