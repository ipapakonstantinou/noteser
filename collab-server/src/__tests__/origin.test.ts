// M1 (2026-11-15 review): the WebSocket upgrade checks Origin against
// ALLOWED_ORIGINS. Tested against the value actually shipped in wrangler.toml.
import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error vite raw import, no node types in this package
import toml from '../../wrangler.toml?raw'
import worker, { isOriginAllowed, type Env } from '../index'

const SHIPPED = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(toml as string)?.[1]

describe('isOriginAllowed with the shipped list', () => {
  it('is configured', () => {
    expect(SHIPPED).toBeTruthy()
  })

  // Every host serving our build with the ws source in its CSP (2026-11-15).
  it.each([
    'https://noteser.app',
    'https://noteser.vercel.app',
    'https://noteser-ipapakonstantinous-projects.vercel.app',
    'https://noteser-git-main-ipapakonstantinous-projects.vercel.app',
    'https://beta.noteser.app',
    'https://dev.noteser.app',
    'https://noteser-git-dev-ipapakonstantinous-projects.vercel.app',
    'https://noteser-8u9ylkn55-ipapakonstantinous-projects.vercel.app',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'HTTPS://NOTESER.APP',
  ])('admits %s', origin => {
    expect(isOriginAllowed(origin, SHIPPED)).toBe(true)
  })

  it.each([
    'https://evil.example',
    'https://noteser.app.evil.example',
    'https://evil.noteser.app',
    'http://noteser.app',
    'https://noteser.app:8443',
    'https://noteser-x.evil.com-ipapakonstantinous-projects.vercel.app',
    // The wildcard takes no hyphen: a lookalike, and every feature-branch alias.
    'https://noteser-abc123def-evil-ipapakonstantinous-projects.vercel.app',
    'https://noteser-git-fix-collab-share-link-ipapakonstantinous-projects.vercel.app',
    'https://other-8u9ylkn55-ipapakonstantinous-projects.vercel.app',
    'https://noteser-8u9ylkn55-someone-else.vercel.app',
    'http://localhost:5000',
    'null',
    '',
  ])('refuses %s', origin => {
    expect(isOriginAllowed(origin, SHIPPED)).toBe(false)
  })

  it('lets a client with no Origin header through (non-browser)', () => {
    expect(isOriginAllowed(null, SHIPPED)).toBe(true)
  })

  it('does no check when the var is unset or blank', () => {
    expect(isOriginAllowed('https://evil.example', undefined)).toBe(true)
    expect(isOriginAllowed('https://evil.example', '  ')).toBe(true)
  })
})

describe('front door', () => {
  function env(): Env & { roomFetch: ReturnType<typeof vi.fn> } {
    const roomFetch = vi.fn(async () => new Response('room'))
    return {
      roomFetch,
      ALLOWED_ORIGINS: SHIPPED,
      AUTH_TOKEN: 'tok',
      Y_ROOM: {
        idFromName: (n: string) => n,
        get: () => ({ fetch: roomFetch }),
      } as unknown as DurableObjectNamespace,
    }
  }
  const upgrade = (origin?: string) =>
    new Request('https://collab.example/tok/room-1', {
      headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}) },
    })

  it('refuses a foreign Origin before the room is touched', async () => {
    const e = env()
    const res = await worker.fetch(upgrade('https://evil.example'), e)
    expect(res.status).toBe(403)
    expect(e.roomFetch).not.toHaveBeenCalled()
  })

  it('hands an allowed Origin (and a header-less client) to the room', async () => {
    const e = env()
    expect(await (await worker.fetch(upgrade('https://noteser.app'), e)).text()).toBe('room')
    expect(await (await worker.fetch(upgrade(), e)).text()).toBe('room')
    expect(e.roomFetch).toHaveBeenCalledTimes(2)
  })
})
