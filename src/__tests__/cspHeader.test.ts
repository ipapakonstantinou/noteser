/**
 * Content-Security-Policy unit tests.
 *
 * Finding 6 of the 2026-05-21 security audit: the CSP used to ship as a
 * STATIC header in next.config.mjs with `script-src 'self' 'unsafe-inline'`,
 * which let an injected inline <script> run. It is now built PER REQUEST in
 * `src/middleware.ts` from a fresh nonce, using the pure helpers in
 * `src/utils/csp.ts`. Those helpers are the source of truth, so we test them
 * directly (no Next server needed).
 *
 * Coverage carried over from the old next.config.mjs test:
 *   - deriveCollabWsOrigin: locks down the connect-src ws(s) origin so the
 *     bare `wss: ws:` wildcards (Finding 5) can't sneak back in.
 *   - connect-src: keeps the HTTPS surfaces, never emits bare ws:/wss:.
 *   - script-src: no 'unsafe-inline'; nonce + 'strict-dynamic' present;
 *     'unsafe-eval' only in dev/test, dropped in production.
 *   - style-src: KEEPS 'unsafe-inline' (Tailwind / styled-jsx / CodeMirror).
 */
import { buildCsp, deriveCollabWsOrigin } from '@/utils/csp'

function getDirective(csp: string, name: string): string {
  const directive = csp
    .split(';')
    .map((s) => s.trim())
    .find((d) => d.startsWith(`${name} `) || d === name)
  if (!directive) throw new Error(`no ${name} directive`)
  return directive
}

const NONCE = 'dGVzdC1ub25jZS12YWx1ZQ=='

describe('deriveCollabWsOrigin', () => {
  it('returns null for unset/empty input', () => {
    expect(deriveCollabWsOrigin(undefined)).toBeNull()
    expect(deriveCollabWsOrigin('')).toBeNull()
  })

  it('returns the origin for a valid wss:// URL', () => {
    expect(deriveCollabWsOrigin('wss://collab.noteser.dev/room/foo')).toBe(
      'wss://collab.noteser.dev'
    )
  })

  it('returns the origin for a valid wss:// URL with a port', () => {
    expect(deriveCollabWsOrigin('wss://collab.noteser.dev:8443/room')).toBe(
      'wss://collab.noteser.dev:8443'
    )
  })

  it('returns the origin for a valid ws:// URL', () => {
    expect(deriveCollabWsOrigin('ws://localhost:1234/yjs')).toBe('ws://localhost:1234')
  })

  it('rejects non-ws schemes (no http/https/javascript/etc.)', () => {
    expect(deriveCollabWsOrigin('https://collab.noteser.dev')).toBeNull()
    expect(deriveCollabWsOrigin('http://collab.noteser.dev')).toBeNull()
    expect(deriveCollabWsOrigin('javascript:alert(1)')).toBeNull()
    expect(deriveCollabWsOrigin('data:text/plain,foo')).toBeNull()
  })

  it('rejects malformed URLs', () => {
    expect(deriveCollabWsOrigin('not a url')).toBeNull()
    expect(deriveCollabWsOrigin('wss://')).toBeNull()
  })
})

describe('connect-src CSP directive (no ws origin)', () => {
  const csp = buildCsp(NONCE, { isDev: false, wsOrigin: null })

  it('omits ws:/wss: entirely', () => {
    const directive = getDirective(csp, 'connect-src')
    expect(directive).not.toContain('wss:')
    expect(directive).not.toContain('ws:')
  })

  it('keeps the originally-scoped HTTPS surfaces', () => {
    const directive = getDirective(csp, 'connect-src')
    expect(directive).toContain("'self'")
    expect(directive).toContain('https://api.github.com')
    expect(directive).toContain('https://github.com')
    expect(directive).toContain('https://api.anthropic.com')
    expect(directive).toContain('https://api.openai.com')
  })
})

describe('connect-src CSP directive (with a derived ws origin)', () => {
  it('adds exactly the derived origin and no bare wildcard', () => {
    const origin = deriveCollabWsOrigin('wss://collab.noteser.dev/room/x')
    expect(origin).toBe('wss://collab.noteser.dev')
    const csp = buildCsp(NONCE, { isDev: false, wsOrigin: origin })
    const directive = getDirective(csp, 'connect-src')
    expect(directive).toContain('wss://collab.noteser.dev')
    expect(directive).not.toContain('*')
    // No bare scheme wildcard slipped in alongside the scoped origin.
    expect(directive.split(/\s+/)).not.toContain('wss:')
    expect(directive.split(/\s+/)).not.toContain('ws:')
  })
})

/**
 * script-src — the heart of Finding 6. No 'unsafe-inline'; a per-request
 * nonce + 'strict-dynamic'. 'unsafe-eval' is added ONLY in dev/test (Next
 * HMR / React Refresh) and dropped in production.
 */
describe('script-src CSP directive', () => {
  it("never contains 'unsafe-inline' (the whole point of the nonce)", () => {
    expect(getDirective(buildCsp(NONCE, { isDev: false, wsOrigin: null }), 'script-src')).not.toContain(
      "'unsafe-inline'"
    )
    expect(getDirective(buildCsp(NONCE, { isDev: true, wsOrigin: null }), 'script-src')).not.toContain(
      "'unsafe-inline'"
    )
  })

  it("carries the per-request nonce and 'strict-dynamic'", () => {
    const directive = getDirective(buildCsp(NONCE, { isDev: false, wsOrigin: null }), 'script-src')
    expect(directive).toContain(`'nonce-${NONCE}'`)
    expect(directive).toContain("'strict-dynamic'")
    expect(directive).toContain("'self'")
  })

  it("drops 'unsafe-eval' in production", () => {
    const directive = getDirective(buildCsp(NONCE, { isDev: false, wsOrigin: null }), 'script-src')
    expect(directive).not.toContain("'unsafe-eval'")
    expect(directive).toBe(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`)
  })

  it("keeps 'unsafe-eval' in dev/test (Next HMR + React Refresh need it)", () => {
    const directive = getDirective(buildCsp(NONCE, { isDev: true, wsOrigin: null }), 'script-src')
    expect(directive).toContain("'unsafe-eval'")
    expect(directive).toBe(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval'`)
  })
})

/**
 * style-src — must KEEP 'unsafe-inline'. Tailwind, styled-jsx and CodeMirror
 * (EditorView.baseTheme) all inject inline <style>; nonce-ing styles would
 * break the editor and the theme. Do NOT regress this.
 */
describe('style-src CSP directive', () => {
  it("keeps 'unsafe-inline' in both prod and dev, never a nonce", () => {
    for (const isDev of [true, false]) {
      const directive = getDirective(buildCsp(NONCE, { isDev, wsOrigin: null }), 'style-src')
      expect(directive).toBe("style-src 'self' 'unsafe-inline'")
      expect(directive).not.toContain('nonce-')
    }
  })
})

describe('other CSP directives are preserved verbatim', () => {
  const csp = buildCsp(NONCE, { isDev: false, wsOrigin: null })
  it('keeps the hardening directives carried over from next.config', () => {
    expect(getDirective(csp, 'default-src')).toBe("default-src 'self'")
    expect(getDirective(csp, 'img-src')).toBe("img-src 'self' data: blob: https:")
    expect(getDirective(csp, 'font-src')).toBe("font-src 'self' data:")
    expect(getDirective(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(getDirective(csp, 'base-uri')).toBe("base-uri 'self'")
    expect(getDirective(csp, 'form-action')).toBe("form-action 'self'")
    expect(getDirective(csp, 'object-src')).toBe("object-src 'none'")
  })
})

/**
 * img-src on /share — the public share page renders content from a URL
 * fragment that can come from anyone with the link. Without restricting
 * img-src there, a shared note's `![]()` becomes a tracking pixel: it
 * confirms the link was opened and leaks the viewer's IP/UA to whatever
 * host the image URL points at. `restrictImages` (wired in middleware.ts
 * for the /share path) drops the `https:` wildcard while keeping
 * same-origin/data:/blob: for the app's own assets and attachments.
 */
describe('img-src with restrictImages (the /share page)', () => {
  it('defaults to including the https: wildcard when unset', () => {
    const csp = buildCsp(NONCE, { isDev: false, wsOrigin: null })
    expect(getDirective(csp, 'img-src')).toBe("img-src 'self' data: blob: https:")
  })

  it('drops the https: wildcard when restrictImages is true', () => {
    const csp = buildCsp(NONCE, { isDev: false, wsOrigin: null, restrictImages: true })
    expect(getDirective(csp, 'img-src')).toBe("img-src 'self' data: blob:")
  })

  it('keeps same-origin/data:/blob: even when restricted', () => {
    const csp = buildCsp(NONCE, { isDev: false, wsOrigin: null, restrictImages: true })
    const directive = getDirective(csp, 'img-src')
    expect(directive).toContain("'self'")
    expect(directive).toContain('data:')
    expect(directive).toContain('blob:')
  })
})

/**
 * PWA directives — the installable-PWA work adds a same-origin service
 * worker (public/sw.js) and a web app manifest. Without these, the strict
 * nonce-based CSP would block worker registration and the manifest fetch.
 * Same-origin only ('self'); no host allowlist, no wildcards.
 */
describe('PWA CSP directives (service worker + manifest)', () => {
  it("scopes worker-src and manifest-src to 'self' in both prod and dev", () => {
    for (const isDev of [true, false]) {
      const csp = buildCsp(NONCE, { isDev, wsOrigin: null })
      expect(getDirective(csp, 'worker-src')).toBe("worker-src 'self'")
      expect(getDirective(csp, 'manifest-src')).toBe("manifest-src 'self'")
    }
  })
})
