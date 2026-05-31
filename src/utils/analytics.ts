// Vercel Web Analytics custom events. The `<Analytics />` provider in
// src/app/layout.tsx records pageviews + referrers automatically; this
// helper adds a tiny funnel on top so we can see "x visited → y created
// a note → z configured sync → w actually pushed" in the dashboard
// Custom Events panel.
//
// Each tracked event is deduplicated per browser session via
// sessionStorage so a power user opening + saving + syncing 40 notes
// only counts once. Funnel-stage events, not action counters.

import { track } from '@vercel/analytics'

const SESSION_PREFIX = 'noteser-tracked:'

export function trackEventOncePerSession(name: string): void {
  if (typeof window === 'undefined') return
  try {
    const key = SESSION_PREFIX + name
    if (window.sessionStorage.getItem(key)) return
    window.sessionStorage.setItem(key, '1')
    track(name)
  } catch {
    // sessionStorage can throw in private-mode Safari etc. Swallow —
    // missing one analytics event is not worth surfacing.
  }
}
