/**
 * pwaProvider.test.tsx (#68 — offline-first Step 1)
 *
 * The PwaProvider already lives on `dev` and ships the manifest + install
 * banner + service-worker registration. Service-worker registration itself
 * is gated on `process.env.NODE_ENV === 'production'`, which Next.js inlines
 * at build time — exercising it in Jest (NODE_ENV=test) requires swapping
 * React's dev/prod entrypoints mid-run, which is too brittle for the value.
 * BRITTLE TEST FLAGGED PER ISSUE GUIDANCE: we skip the production-only
 * registration assertion and instead lock the surface that DOES survive a
 * test-mode render:
 *
 *   1. The provider mounts cleanly in jsdom without throwing (the most
 *      common regression — a typo in the SW gate, a top-level `navigator`
 *      read that breaks SSR, etc).
 *   2. In a test-mode env (no `navigator.serviceWorker`, no SW registered),
 *      the provider renders `null` (no install banner, no update banner).
 *      That null is the contract every page in the app depends on so its
 *      mount is invisible until a real event fires.
 *
 * For the registration side-effect itself: the file `public/sw.js` plus
 * the `pwaManifest.test.ts` smoke-test together cover the wire shape, and
 * the manual smoke (Devtools → Application → Service Workers) catches the
 * register call in a real Chrome build.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { PwaProvider, isIosSafari, isStandalone } from '../components/pwa/PwaProvider'

describe('PwaProvider', () => {
  test('mounts without throwing in jsdom (no serviceWorker, no install event)', () => {
    expect(() => render(<PwaProvider />)).not.toThrow()
  })

  test('renders nothing until an install or update event fires', () => {
    const { container } = render(<PwaProvider />)
    // No banner means an empty render — the provider returns `null`
    // when there is nothing to surface. Whitespace-only is fine.
    expect(container.textContent ?? '').toBe('')
  })

  test('isIosSafari is callable and returns a boolean (jsdom has no UA shenanigans)', () => {
    expect(typeof isIosSafari()).toBe('boolean')
  })

  test('isStandalone is callable and returns a boolean', () => {
    expect(typeof isStandalone()).toBe('boolean')
  })
})
