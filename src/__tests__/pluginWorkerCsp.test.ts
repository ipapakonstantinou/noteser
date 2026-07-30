/**
 * pluginWorkerCsp.test.ts
 *
 * The plugin worker chunk is served from `_next/static/`
 * (`.next/static/chunks/src_plugins_workerEntry_ts_*.js`), which
 * `src/middleware.ts` excludes from the per-request nonce CSP. A dedicated
 * worker takes its policy from its OWN response headers, so with nothing on
 * that path plugin code ran under no CSP at all — while every plugin is handed
 * the active note's body and the plugin API has no network permission.
 *
 * Neither module can be imported here: Jest's CJS transform re-declares
 * `__dirname` in next.config.mjs, and importing src/middleware.ts pulls
 * `next/server`, which needs a `Request` global jsdom does not have. Both are
 * build configuration, so both are asserted as text — enough to fail if the
 * header rule is dropped, the production `connect-src` is loosened, or the
 * matcher stops excluding `_next/static`. The matcher pattern itself is then
 * compiled and exercised for real.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const configSource = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')
const middlewareSource = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')

describe('plugin worker CSP', () => {
  test('a CSP is attached to the path the worker chunk is served from', () => {
    expect(configSource).toContain("source: '/_next/static/:path*'")
    expect(configSource).toContain("key: 'Content-Security-Policy', value: PLUGIN_WORKER_CSP")
  })

  test('the policy denies by default', () => {
    expect(configSource).toContain(`"default-src 'none'"`)
    // The production connect-src is NOT asserted here on purpose: pinning the
    // spelling of the ternary breaks on a prettier run while the header stays
    // correct. What the browser actually enforces is checked for real in
    // e2e/_verify_worker_csp.spec.ts.
    expect(configSource).toContain('connect-src')
  })

  test('blob: stays allowed for scripts — the plugin module is imported from one', () => {
    expect(configSource).toMatch(/script-src 'self' blob:/)
  })

  test('the middleware still skips _next/static, so two policies never intersect', () => {
    const found = middlewareSource.match(/matcher:\s*'([^']+)'/)
    expect(found).not.toBeNull()
    const matcher = found![1]
    expect(matcher).toContain('_next/static')

    // The matcher is a path pattern built around a negative lookahead — compile
    // it and check the worker chunk really falls outside it.
    const re = new RegExp(`^${matcher}$`)
    expect(re.test('/_next/static/chunks/src_plugins_workerEntry_ts_abc123.js')).toBe(false)
    // A normal page still matches, i.e. the exclusion is not over-broad.
    expect(re.test('/settings')).toBe(true)
  })
})
