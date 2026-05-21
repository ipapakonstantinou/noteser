/**
 * @jest-environment node
 *
 * GitHubAPIError covers the typed error thrown by every Git Data API
 * helper. It carries status, GitHub's `message` field, the rate-limit
 * reset epoch, and a remaining quota — enough for the UI to render a
 * precise message instead of "Failed (403)".
 */

import { GitHubAPIError, ensureOk } from '../utils/github'

function makeRes(status: number, body: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  })
}

describe('GitHubAPIError', () => {
  test('captures status + operation + GitHub message', async () => {
    const res = makeRes(422, { message: 'Update is not a fast forward' })
    const err = await GitHubAPIError.fromResponse(res, 'Update branch ref')
    expect(err).toBeInstanceOf(GitHubAPIError)
    expect(err.status).toBe(422)
    expect(err.operation).toBe('Update branch ref')
    expect(err.githubMessage).toBe('Update is not a fast forward')
    expect(err.message).toContain('Update branch ref')
    expect(err.message).toContain('422')
    expect(err.message).toContain('Update is not a fast forward')
  })

  test('handles non-JSON bodies gracefully', async () => {
    const res = new Response('not json', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    })
    const err = await GitHubAPIError.fromResponse(res, 'Create blob')
    expect(err.status).toBe(500)
    expect(err.githubMessage).toBeNull()
  })

  test('captures rate-limit headers', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const res = makeRes(403, { message: 'API rate limit exceeded' }, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(reset),
    })
    const err = await GitHubAPIError.fromResponse(res, 'Read tree')
    expect(err.isRateLimit).toBe(true)
    expect(err.remaining).toBe(0)
    expect(err.rateLimitReset).toBe(reset)
    const seconds = err.resetInSeconds()
    expect(seconds).not.toBeNull()
    expect(seconds!).toBeGreaterThanOrEqual(599)
    expect(seconds!).toBeLessThanOrEqual(601)
  })

  test('429 is a rate-limit regardless of headers', async () => {
    const err = await GitHubAPIError.fromResponse(makeRes(429), 'Read ref')
    expect(err.isRateLimit).toBe(true)
  })

  test('403 without rate-limit headers is NOT a rate-limit', async () => {
    const err = await GitHubAPIError.fromResponse(makeRes(403, { message: 'Forbidden' }), 'Create commit')
    expect(err.isRateLimit).toBe(false)
  })

  test('resetInSeconds returns null when reset is missing', async () => {
    const err = await GitHubAPIError.fromResponse(makeRes(500), 'List branches')
    expect(err.resetInSeconds()).toBeNull()
  })

  test('resetInSeconds returns 0 (not negative) when reset is in the past', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    const res = makeRes(403, null, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(past) })
    const err = await GitHubAPIError.fromResponse(res, 'Read tree')
    expect(err.resetInSeconds()).toBe(0)
  })
})

describe('ensureOk', () => {
  test('returns silently on 200', async () => {
    await expect(ensureOk(makeRes(200, {}), 'op')).resolves.toBeUndefined()
  })

  test('throws GitHubAPIError on non-ok', async () => {
    await expect(ensureOk(makeRes(404, { message: 'Not found' }), 'Fetch repo'))
      .rejects.toBeInstanceOf(GitHubAPIError)
  })
})
