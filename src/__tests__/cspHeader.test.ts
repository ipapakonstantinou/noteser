/**
 * Locks down the connect-src directive in next.config.mjs so the bare
 * `wss: ws:` wildcards can't sneak back in. Finding 5 of the 2026-05-21
 * security audit: the wildcards would let an XSS payload exfiltrate
 * localStorage (GitHub token, AI keys) to any attacker-controlled WS host.
 *
 * The module reads `process.env.NEXT_PUBLIC_YJS_WS_URL` at evaluation time,
 * so for the env-set branches we exercise the exported helper
 * (`deriveCollabWsOrigin`). The default-env directive is also asserted as a
 * snapshot of the loaded module so the bare wildcards can't slip back in.
 */

// next.config.mjs is the test target; the import is type-only here and
// resolved by jest at runtime via dynamic import below.
type ConfigModule = {
  deriveCollabWsOrigin: (raw: string | undefined) => string | null
  securityHeaders: Array<{ key: string; value: string }>
}

function getConnectSrc(headers: ConfigModule['securityHeaders']): string {
  const csp = headers.find((h) => h.key === 'Content-Security-Policy')
  if (!csp) throw new Error('no CSP header')
  const directive = csp.value
    .split(';')
    .map((s) => s.trim())
    .find((d) => d.startsWith('connect-src'))
  if (!directive) throw new Error('no connect-src directive')
  return directive
}

let mod: ConfigModule

beforeAll(async () => {
  // Ensure the module evaluates with no NEXT_PUBLIC_YJS_WS_URL so the
  // snapshot below reflects the "WS disabled" branch.
  delete process.env.NEXT_PUBLIC_YJS_WS_URL
  // next.config.mjs has no .d.ts and intentionally exports unannotated
  // helpers; cast through unknown to keep typecheck happy.
  mod = (await import('../../next.config.mjs' as string)) as unknown as ConfigModule
})

describe('deriveCollabWsOrigin', () => {
  it('returns null for unset/empty input', () => {
    expect(mod.deriveCollabWsOrigin(undefined)).toBeNull()
    expect(mod.deriveCollabWsOrigin('')).toBeNull()
  })

  it('returns the origin for a valid wss:// URL', () => {
    expect(mod.deriveCollabWsOrigin('wss://collab.noteser.dev/room/foo')).toBe(
      'wss://collab.noteser.dev'
    )
  })

  it('returns the origin for a valid wss:// URL with a port', () => {
    expect(mod.deriveCollabWsOrigin('wss://collab.noteser.dev:8443/room')).toBe(
      'wss://collab.noteser.dev:8443'
    )
  })

  it('returns the origin for a valid ws:// URL', () => {
    expect(mod.deriveCollabWsOrigin('ws://localhost:1234/yjs')).toBe('ws://localhost:1234')
  })

  it('rejects non-ws schemes (no http/https/javascript/etc.)', () => {
    expect(mod.deriveCollabWsOrigin('https://collab.noteser.dev')).toBeNull()
    expect(mod.deriveCollabWsOrigin('http://collab.noteser.dev')).toBeNull()
    expect(mod.deriveCollabWsOrigin('javascript:alert(1)')).toBeNull()
    expect(mod.deriveCollabWsOrigin('data:text/plain,foo')).toBeNull()
  })

  it('rejects malformed URLs', () => {
    expect(mod.deriveCollabWsOrigin('not a url')).toBeNull()
    expect(mod.deriveCollabWsOrigin('wss://')).toBeNull()
  })
})

describe('connect-src CSP directive (default, no NEXT_PUBLIC_YJS_WS_URL)', () => {
  it('omits ws:/wss: entirely', () => {
    const directive = getConnectSrc(mod.securityHeaders)
    // No bare scheme wildcards anywhere in the directive.
    expect(directive).not.toContain('wss:')
    expect(directive).not.toContain('ws:')
  })

  it('keeps the originally-scoped HTTPS surfaces', () => {
    const directive = getConnectSrc(mod.securityHeaders)
    expect(directive).toContain("'self'")
    expect(directive).toContain('https://api.github.com')
    expect(directive).toContain('https://github.com')
    expect(directive).toContain('https://api.anthropic.com')
    expect(directive).toContain('https://api.openai.com')
  })

  it('exposes the directive at the start of the value', () => {
    const directive = getConnectSrc(mod.securityHeaders)
    expect(directive.startsWith('connect-src ')).toBe(true)
  })
})

describe('connect-src CSP directive (with NEXT_PUBLIC_YJS_WS_URL)', () => {
  // The module-level env was read once at import. For the env-set branch we
  // rely on the helper (which is the only branching logic) plus the fact
  // that the connect-src list interpolates exactly its return value.
  it('would add the exact origin (and nothing else) for a valid wss URL', () => {
    const origin = mod.deriveCollabWsOrigin('wss://collab.noteser.dev/room/x')
    expect(origin).toBe('wss://collab.noteser.dev')
    // The directive composition: `connect-src <fixed list> <origin>`.
    // Confirms no bare wildcard appears.
    expect(origin).not.toContain('*')
    expect(origin).not.toMatch(/^wss:\s*$/)
    expect(origin).not.toMatch(/^ws:\s*$/)
  })

  it('falls back to null (= no WS in directive) when malformed', () => {
    expect(mod.deriveCollabWsOrigin('https://not-a-ws-url.example')).toBeNull()
    expect(mod.deriveCollabWsOrigin('totally bogus')).toBeNull()
  })
})
