// Shared boilerplate for parity specs.
//
// `setupCleanVault` runs before each test:
//   1. Clears localStorage + the known IndexedDB databases so persisted
//      state from a previous run doesn't leak in.
//   2. Pre-seeds `noteser-settings` with `onboardingShown: true` so the
//      OnboardingModal (which mounts on a truly empty vault and traps
//      pointer events under a full-screen backdrop) doesn't block the
//      subsequent test interactions.
//
// `waitForTestHooks` waits until `window.__noteser_test` is defined,
// which happens during React hydration (client-side mount). The folder-tree
// element can be visible earlier (via SSR HTML) before hydration completes,
// so callers that need the store API should call this instead of (or in
// addition to) asserting `folder-tree` visible.

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

/** Wait for React hydration to complete by polling for `window.__noteser_test`. */
export async function waitForTestHooks(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout },
  )
}
