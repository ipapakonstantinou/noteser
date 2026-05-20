/**
 * settingsMigration.test.ts
 *
 * Verifies the persist `migrate` function on useSettingsStore that
 * strips the historical pinnedPanels=['calendar'] default when an
 * old install rehydrates. Without it, returning users would still
 * see Calendar pinned at the top even though the user explicitly
 * asked for it to live in the tab strip.
 *
 * Pulls the migrate function out via the same shape Zustand passes
 * it (raw persisted JSON + version number).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

// We re-require the module to grab the persist options. Easier than
// exporting `migrate` separately.
import { useSettingsStore } from '../stores/settingsStore'

// Pull the migrate fn off the store's persist API. The cast keeps TS
// quiet — the Zustand persist API exposes this on the store at
// `useSettingsStore.persist.getOptions()`.
type PersistStore = typeof useSettingsStore & {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } }
}
const migrate = (useSettingsStore as PersistStore).persist.getOptions().migrate!

test('v0 default ["calendar"] is reset to [] so Calendar lands in the tab strip', () => {
  const out = migrate({ pinnedPanels: ['calendar'] }, 0) as { pinnedPanels: string[] }
  expect(out.pinnedPanels).toEqual([])
})

test('v0 with empty pinnedPanels stays empty (no-op)', () => {
  const out = migrate({ pinnedPanels: [] }, 0) as { pinnedPanels: string[] }
  expect(out.pinnedPanels).toEqual([])
})

test('v0 with a user-customised list keeps every entry', () => {
  // If the user explicitly pinned multiple panels (or pinned
  // something else), respect their choice — only reset the EXACT
  // historical default.
  const out = migrate({ pinnedPanels: ['calendar', 'outline'] }, 0) as { pinnedPanels: string[] }
  expect(out.pinnedPanels).toEqual(['calendar', 'outline'])
})

test('v0 with a single non-calendar pin keeps the entry', () => {
  const out = migrate({ pinnedPanels: ['outline'] }, 0) as { pinnedPanels: string[] }
  expect(out.pinnedPanels).toEqual(['outline'])
})

test('v1+ states are passed through untouched', () => {
  // The migrate function should be a no-op for already-migrated
  // installs so a future v2 migration can layer on cleanly.
  const out = migrate({ pinnedPanels: ['calendar'] }, 1) as { pinnedPanels: string[] }
  expect(out.pinnedPanels).toEqual(['calendar'])
})

test('handles missing pinnedPanels gracefully', () => {
  // Old installs that pre-date the field shouldn't crash the
  // migrate fn — they get passed through and defaults fill in.
  const out = migrate({}, 0) as { pinnedPanels?: string[] }
  expect(out.pinnedPanels).toBeUndefined()
})
