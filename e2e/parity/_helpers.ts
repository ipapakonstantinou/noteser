// Shared boilerplate for parity specs.
//
// `setupCleanVault` runs before each test:
//   1. Clears localStorage + the known IndexedDB databases so persisted
//      state from a previous run doesn't leak in.
//   2. Pre-seeds `noteser-settings` with `onboardingShown: true` so the
//      OnboardingModal (which mounts on a truly empty vault and traps
//      pointer events under a full-screen backdrop) doesn't block the
//      subsequent test interactions.

import type { Page } from '@playwright/test'

export async function setupCleanVault(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-set the persisted settings store so the onboarding modal
    // doesn't appear. Zustand's persist middleware reads this on
    // hydration; the shape is { state: {...}, version: <n> }.
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: true }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}
