/**
 * @jest-environment node
 *
 * Uses the node test environment for native Response / Headers / Request,
 * the same way githubFetch.test.ts does. jsdom drops those.
 */

import { publishGist, sanitizeGistFilename, GistScopeError } from '../utils/githubGist'
import { GitHubAPIError } from '../utils/github'

// Stub global fetch for these tests. githubFetch wraps fetch with retries
// for 5xx; we always return 2xx/4xx here so the retry path is irrelevant.
const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  ;(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const init = {
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  }
  return new Response(JSON.stringify(body), init)
}

describe('sanitizeGistFilename', () => {
  it('forces a .md extension', () => {
    expect(sanitizeGistFilename('Hello World')).toBe('Hello-World.md')
  })

  it('keeps an existing .md extension instead of appending another one', () => {
    expect(sanitizeGistFilename('notes.md')).toBe('notes.md')
  })

  it('strips characters GitHub rejects in gist filenames (slash becomes dash, !@# dropped)', () => {
    expect(sanitizeGistFilename('weird/!@#%title')).toBe('weird-title.md')
  })

  it('collapses whitespace and slashes to dashes', () => {
    expect(sanitizeGistFilename('a  / b  /  c')).toBe('a-b-c.md')
  })

  it('falls back to a safe default for empty / whitespace-only titles', () => {
    expect(sanitizeGistFilename('')).toBe('note.md')
    expect(sanitizeGistFilename('   ')).toBe('note.md')
  })

  it('checks the .md suffix case-insensitively so Notes.MD stays as-is', () => {
    expect(sanitizeGistFilename('Notes.MD')).toBe('Notes.MD')
  })
})

describe('publishGist — happy path', () => {
  it('POSTs to /gists with the expected body and returns the URL', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, {
      id: 'abc123',
      html_url: 'https://gist.github.com/u/abc123',
      url: 'https://api.github.com/gists/abc123',
    }))

    const result = await publishGist({
      token: 'tok',
      filename: 'hello.md',
      content: '# Hello',
      description: 'a test',
      isPublic: false,
    })

    expect(result).toEqual({
      id: 'abc123',
      htmlUrl: 'https://gist.github.com/u/abc123',
      apiUrl: 'https://api.github.com/gists/abc123',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/gists')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.description).toBe('a test')
    expect(body.public).toBe(false)
    expect(body.files['hello.md'].content).toBe('# Hello')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('passes public=true through for public gists', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, {
      id: 'pub', html_url: 'https://gist.github.com/u/pub', url: 'https://api.github.com/gists/pub',
    }))
    await publishGist({ token: 't', filename: 'n.md', content: '', isPublic: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.public).toBe(true)
  })
})

describe('publishGist — scope failure', () => {
  it('throws GistScopeError on 404 (missing gist scope)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404, { message: 'Not Found' }))
    await expect(
      publishGist({ token: 't', filename: 'n.md', content: '', isPublic: false }),
    ).rejects.toBeInstanceOf(GistScopeError)
  })

  it('throws GistScopeError on 401 (expired token)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Bad credentials' }))
    await expect(
      publishGist({ token: 't', filename: 'n.md', content: '', isPublic: false }),
    ).rejects.toBeInstanceOf(GistScopeError)
  })

  it('exposes the underlying GitHubAPIError for diagnostic UI', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404, { message: 'Not Found' }))
    try {
      await publishGist({ token: 't', filename: 'n.md', content: '', isPublic: false })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GistScopeError)
      expect((err as GistScopeError).underlying).toBeInstanceOf(GitHubAPIError)
      expect((err as GistScopeError).underlying.status).toBe(404)
    }
  })
})

describe('publishGist — other failures', () => {
  it('throws a plain GitHubAPIError for unexpected non-2xx (e.g. 422)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(422, { message: 'validation failed' }))
    await expect(
      publishGist({ token: 't', filename: 'n.md', content: '', isPublic: false }),
    ).rejects.toBeInstanceOf(GitHubAPIError)
  })

  it('does NOT wrap an unrelated error as a GistScopeError', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(422, { message: 'validation failed' }))
    try {
      await publishGist({ token: 't', filename: 'n.md', content: '', isPublic: false })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).not.toBeInstanceOf(GistScopeError)
    }
  })
})
