/**
 * @jest-environment node
 *
 * githubHistory.ts: per-file commit history + content-at-commit
 * helpers. Mocks the network layer at the fetch boundary so the
 * Bearer-auth + base64 decode + relative-date formatting all run end
 * to end without hitting api.github.com.
 */

import { listFileCommits, getFileContentAtCommit, formatRelativeAuthorDate } from '../utils/githubHistory'
import { GitHubAPIError } from '../utils/github'

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const ORIG_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIG_FETCH
})

describe('listFileCommits', () => {
  test('maps GitHub /commits response to the FileCommitEntry shape', async () => {
    global.fetch = jest.fn(async () => jsonRes([
      {
        sha: '0123456789abcdef',
        commit: {
          message: 'Bump roadmap\n\nLong body that should be discarded',
          author: { name: 'Alice', date: '2026-05-21T10:00:00Z' },
        },
        html_url: 'https://github.com/o/r/commit/0123456',
      },
      {
        sha: 'fedcba9876543210',
        commit: {
          message: 'Initial commit',
          author: { name: 'Bob', date: '2026-05-19T08:00:00Z' },
        },
        html_url: 'https://github.com/o/r/commit/fedcba9',
      },
    ])) as unknown as typeof fetch

    const out = await listFileCommits('t', 'o', 'r', 'Notes/A.md')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      sha: '0123456789abcdef',
      shortSha: '0123456',
      message: 'Bump roadmap',
      authorName: 'Alice',
      authorDate: '2026-05-21T10:00:00Z',
      htmlUrl: 'https://github.com/o/r/commit/0123456',
    })
    expect(out[1].message).toBe('Initial commit')
  })

  test('path is URL-encoded so spaces / unicode round-trip', async () => {
    let captured = ''
    global.fetch = jest.fn(async (url) => {
      captured = String(url)
      return jsonRes([])
    }) as unknown as typeof fetch
    await listFileCommits('t', 'o', 'r', 'My Folder/My Note.md')
    expect(captured).toContain('path=My%20Folder%2FMy%20Note.md')
  })

  test('perPage is clamped to [1, 100]', async () => {
    const captures: string[] = []
    global.fetch = jest.fn(async (url) => {
      captures.push(String(url))
      return jsonRes([])
    }) as unknown as typeof fetch
    await listFileCommits('t', 'o', 'r', 'A.md', { perPage: 0 })
    await listFileCommits('t', 'o', 'r', 'A.md', { perPage: 9999 })
    await listFileCommits('t', 'o', 'r', 'A.md', { perPage: 25 })
    expect(captures[0]).toContain('per_page=1')
    expect(captures[1]).toContain('per_page=100')
    expect(captures[2]).toContain('per_page=25')
  })

  test('non-2xx surfaces as GitHubAPIError', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    await expect(listFileCommits('t', 'o', 'r', 'A.md')).rejects.toBeInstanceOf(GitHubAPIError)
  })
})

describe('getFileContentAtCommit', () => {
  test('decodes base64 + strips embedded newlines', async () => {
    // "Hello\n" base64-encoded with a wrapping newline halfway through.
    // (GitHub wraps base64 at 60 chars in real responses.)
    const payload = btoa('Hello\n')
    const wrapped = payload.slice(0, 4) + '\n' + payload.slice(4)
    global.fetch = jest.fn(async () => jsonRes({
      encoding: 'base64',
      content: wrapped,
    })) as unknown as typeof fetch
    const out = await getFileContentAtCommit('t', 'o', 'r', 'A.md', 'abc123')
    expect(out).toBe('Hello\n')
  })

  test('UTF-8 bytes round-trip', async () => {
    const original = '✅ τάδε έφη Ζαρατούστρα — done\n'
    const bytes = new TextEncoder().encode(original)
    // Convert bytes → binary string → base64 (test-side, mirrors how
    // GitHub would have it).
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    const b64 = btoa(bin)
    global.fetch = jest.fn(async () => jsonRes({
      encoding: 'base64',
      content: b64,
    })) as unknown as typeof fetch
    const out = await getFileContentAtCommit('t', 'o', 'r', 'A.md', 'abc123')
    expect(out).toBe(original)
  })

  test('non-2xx surfaces as GitHubAPIError', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{}', { status: 422, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch
    await expect(getFileContentAtCommit('t', 'o', 'r', 'A.md', 'abc')).rejects.toBeInstanceOf(GitHubAPIError)
  })
})

describe('formatRelativeAuthorDate', () => {
  const NOW = Date.parse('2026-05-22T12:00:00Z')

  test.each([
    ['2026-05-22T11:59:30Z', 'just now'],
    ['2026-05-22T11:55:00Z', '5m ago'],
    ['2026-05-22T08:00:00Z', '4h ago'],
    ['2026-05-21T12:00:00Z', '1d ago'],
    ['2026-04-22T12:00:00Z', '1mo ago'],
    ['2025-05-22T12:00:00Z', '1y ago'],
    ['2026-05-22T12:01:00Z', 'just now'], // future → just now
    ['', ''],
    ['not-a-date', ''],
  ])('"%s" → "%s"', (iso, expected) => {
    expect(formatRelativeAuthorDate(iso, NOW)).toBe(expected)
  })
})
