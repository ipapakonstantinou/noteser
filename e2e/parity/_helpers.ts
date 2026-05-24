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

import { expect, type Page } from '@playwright/test'

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

// Right-clicking a sidebar tab icon used to instantly pin/unpin it. Since
// 2026-05-22 it opens a context menu (TabContextMenu) with "Pin to top" /
// "Unpin" / "Hide tab" instead — see src/components/sidebar/TabContextMenu.tsx.
// These helpers drive that menu so specs read as "pin this tab" / "unpin
// this tab" without repeating the open-menu-then-click dance.

/** Right-click a bottom-strip tab icon and choose "Pin to top". */
export async function pinTabViaMenu(page: Page, tabId: string): Promise<void> {
  await page.getByTestId(`sidebar-tab-${tabId}`).click({ button: 'right' })
  await expect(page.getByTestId('tab-context-menu')).toBeVisible()
  await page.getByTestId('tab-context-menu-pin').click()
}

/** Right-click a pinned mini-strip icon and choose "Unpin". */
export async function unpinTabViaMenu(page: Page, tabId: string): Promise<void> {
  await page.getByTestId(`sidebar-pinned-tab-${tabId}`).click({ button: 'right' })
  await expect(page.getByTestId('tab-context-menu')).toBeVisible()
  await page.getByTestId('tab-context-menu-unpin').click()
}
