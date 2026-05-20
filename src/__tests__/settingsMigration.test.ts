/**
 * settingsMigration.test.ts
 *
 * Verifies the persist `migrate` function on useSettingsStore.
 * Two ladders cover today:
 *   v0→v1 — strip pinnedPanels=['calendar'] default
 *   v1→v2 — wrap flat string[] into string[][] groups
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { useSettingsStore } from '../stores/settingsStore'

type PersistStore = typeof useSettingsStore & {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } }
}
const migrate = (useSettingsStore as PersistStore).persist.getOptions().migrate!

// Tiny helper so each call site doesn't repeat the same cast chain.
function run(state: unknown, version: number): { pinnedPanels?: unknown } {
  return migrate(state, version) as unknown as { pinnedPanels?: unknown }
}

// ── v0 reset (historical Calendar default) ─────────────────────────────────

test('v0 default ["calendar"] is reset to [] AND then wrapped into [][] by v1→v2', () => {
  // v0 input goes through BOTH ladders — first reset then wrap.
  // Result after v1→v2 wrapping of [] is still [].
  const out = run({ pinnedPanels: ['calendar'] }, 0)
  expect(out.pinnedPanels).toEqual([])
})

test('v0 with empty pinnedPanels stays empty', () => {
  const out = run({ pinnedPanels: [] }, 0)
  expect(out.pinnedPanels).toEqual([])
})

test('v0 with a user-customised list keeps every entry (then wraps into groups)', () => {
  // Custom flat ['calendar', 'outline'] survives v0→v1 (not the EXACT
  // default), then v1→v2 wraps into singleton groups.
  const out = run({ pinnedPanels: ['calendar', 'outline'] }, 0)
  expect(out.pinnedPanels).toEqual([['calendar'], ['outline']])
})

test('v0 with a single non-calendar pin keeps + wraps the entry', () => {
  const out = run({ pinnedPanels: ['outline'] }, 0)
  expect(out.pinnedPanels).toEqual([['outline']])
})

// ── v1→v2 (flat → grouped) ────────────────────────────────────────────────

test('v1 flat array gets wrapped into per-id singleton groups', () => {
  const out = run({ pinnedPanels: ['calendar', 'source-control'] }, 1)
  expect(out.pinnedPanels).toEqual([['calendar'], ['source-control']])
})

test('v1 empty array stays empty when wrapped', () => {
  const out = run({ pinnedPanels: [] }, 1)
  expect(out.pinnedPanels).toEqual([])
})

// ── v2+ pass-through ─────────────────────────────────────────────────────

test('v2 nested arrays pass through untouched (no double-wrap)', () => {
  const out = run({ pinnedPanels: [['calendar', 'outline'], ['source-control']] }, 2)
  expect(out.pinnedPanels).toEqual([['calendar', 'outline'], ['source-control']])
})

test('handles missing pinnedPanels gracefully across all versions', () => {
  expect(run({}, 0).pinnedPanels).toBeUndefined()
  expect(run({}, 1).pinnedPanels).toBeUndefined()
  expect(run({}, 2).pinnedPanels).toBeUndefined()
})
