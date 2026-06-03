/**
 * @jest-environment node
 *
 * Installer fetch + validate pipeline. Network is faked via
 * jest.spyOn(global, 'fetch') so the test stays hermetic.
 */

import { fetchPluginFromUrl, sha256Hex } from '@/plugins/installer'

const VALID_MANIFEST = {
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  main: './main.js',
  surfaces: { commands: [{ id: 'say', title: 'Say' }] },
}

const VALID_MAIN_SOURCE = 'export default { id: "echo" }'

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
function textResp(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } })
}

describe('fetchPluginFromUrl', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('happy path: fetches manifest + main, hashes, returns record', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const s = String(url)
      if (s.endsWith('manifest.json')) return jsonResp(VALID_MANIFEST)
      if (s.endsWith('main.js')) return textResp(VALID_MAIN_SOURCE)
      return new Response('not found', { status: 404 })
    })

    const result = await fetchPluginFromUrl('https://example.com/p/manifest.json')
    expect(result.manifest.id).toBe('echo')
    expect(result.mainSource).toBe(VALID_MAIN_SOURCE)
    expect(result.hash).toHaveLength(64)
    expect(result.hash).toMatch(/^[0-9a-f]+$/)
    expect(result.sourceUrl).toBe('https://example.com/p/manifest.json')
  })

  test('rejects HTTP URLs that are not localhost', async () => {
    await expect(fetchPluginFromUrl('http://example.com/manifest.json')).rejects.toThrow(/HTTPS/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('accepts http://localhost (dev mode)', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const s = String(url)
      if (s.endsWith('manifest.json')) return jsonResp(VALID_MANIFEST)
      return textResp(VALID_MAIN_SOURCE)
    })
    const r = await fetchPluginFromUrl('http://localhost:5173/manifest.json')
    expect(r.manifest.id).toBe('echo')
  })

  test('rejects manifest without main field', async () => {
    const noMain = { ...VALID_MANIFEST, main: undefined }
    fetchSpy.mockImplementation(async () => jsonResp(noMain))
    await expect(fetchPluginFromUrl('https://example.com/manifest.json')).rejects.toThrow(/"main"/)
  })

  test('rejects manifest that fails schema validation', async () => {
    const badId = { ...VALID_MANIFEST, id: 'X' /* uppercase, invalid */ }
    fetchSpy.mockImplementation(async (url) => {
      const s = String(url)
      if (s.endsWith('manifest.json')) return jsonResp(badId)
      return textResp(VALID_MAIN_SOURCE)
    })
    await expect(fetchPluginFromUrl('https://example.com/manifest.json')).rejects.toThrow(/manifest/i)
  })

  test('rejects manifest that is not JSON', async () => {
    fetchSpy.mockImplementation(async () => textResp('<!doctype html>'))
    await expect(fetchPluginFromUrl('https://example.com/manifest.json')).rejects.toThrow(/JSON/)
  })

  test('resolves relative main url against manifest url', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const s = String(url)
      if (s.endsWith('manifest.json')) return jsonResp(VALID_MANIFEST)
      // main.js is requested at the relative-resolved URL
      expect(s).toBe('https://example.com/p/main.js')
      return textResp(VALID_MAIN_SOURCE)
    })
    await fetchPluginFromUrl('https://example.com/p/manifest.json')
  })

  test('rejects when the main bundle returns 404', async () => {
    fetchSpy.mockImplementation(async (url) => {
      const s = String(url)
      if (s.endsWith('manifest.json')) return jsonResp(VALID_MANIFEST)
      return new Response('not found', { status: 404 })
    })
    await expect(fetchPluginFromUrl('https://example.com/p/manifest.json')).rejects.toThrow(/HTTP 404/)
  })
})

describe('sha256Hex', () => {
  test('matches a known vector', async () => {
    // SHA-256 of the empty string is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('changes when one byte changes', async () => {
    const a = await sha256Hex('hello')
    const b = await sha256Hex('Hello')
    expect(a).not.toBe(b)
  })
})
